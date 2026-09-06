// Query layer over a project database: collections, entries, publish
// materialization, field-delta revisions with atomic revert, API keys.

import { createHash, randomUUID } from 'node:crypto';
import { randomToken } from './crypto.ts';

export const FIELD_TYPES = ['text', 'markdown', 'number', 'boolean', 'date', 'json'];

const REVISIONS_KEEP = 20;
const REVISIONS_MAX_AGE_DAYS = 90;

// ---- Slugs ---------------------------------------------------------------

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '') || 'untitled';
}

// Appends -2, -3, ... until `exists(candidate)` is false.
export function uniqueSlug(base, exists) {
  let candidate = base;
  for (let n = 2; exists(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

// ---- Content version (ETag source) --------------------------------------

export function contentVersion(db) {
  return db.prepare("SELECT value FROM meta WHERE key = 'content_version'").get()?.value ?? '0';
}

export function bumpContentVersion(db) {
  db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'content_version'").run();
}

// ---- Collections ---------------------------------------------------------

export function listCollections(db) {
  return db.prepare('SELECT * FROM collections ORDER BY name').all().map(parseCollection);
}

export function getCollection(db, slug) {
  const row = db.prepare('SELECT * FROM collections WHERE slug = ?').get(slug);
  return row ? parseCollection(row) : null;
}

function parseCollection(row) {
  return { ...row, fields: JSON.parse(row.fields) };
}

export function createCollection(db, name) {
  const slug = uniqueSlug(slugify(name), (s) => !!db.prepare('SELECT 1 FROM collections WHERE slug = ?').get(s));
  db.prepare('INSERT INTO collections (slug, name) VALUES (?, ?)').run(slug, name);
  return getCollection(db, slug);
}

export function addCollectionField(db, collectionSlug, { label, type }) {
  const collection = getCollection(db, collectionSlug);
  if (!collection) return null;
  if (!FIELD_TYPES.includes(type)) throw new Error(`Unknown field type: ${type}`);
  const name = uniqueSlug(slugify(label), (s) => collection.fields.some((f) => f.name === s));
  const fields = [...collection.fields, { name, label, type }];
  db.prepare('UPDATE collections SET fields = ? WHERE id = ?').run(JSON.stringify(fields), collection.id);
  return getCollection(db, collectionSlug);
}

export function reorderCollectionFields(db, collectionSlug, orderedNames) {
  const collection = getCollection(db, collectionSlug);
  if (!collection) return null;
  const byName = new Map(collection.fields.map((f) => [f.name, f]));
  const fields = orderedNames.map((n) => byName.get(n)).filter(Boolean);
  if (fields.length !== collection.fields.length) return collection; // stale client order, ignore
  db.prepare('UPDATE collections SET fields = ? WHERE id = ?').run(JSON.stringify(fields), collection.id);
  return getCollection(db, collectionSlug);
}

export function removeCollectionField(db, collectionSlug, fieldName) {
  const collection = getCollection(db, collectionSlug);
  if (!collection) return null;
  const fields = collection.fields.filter((f) => f.name !== fieldName);
  db.prepare('UPDATE collections SET fields = ? WHERE id = ?').run(JSON.stringify(fields), collection.id);
}

export function deleteCollection(db, slug) {
  db.prepare('DELETE FROM collections WHERE slug = ?').run(slug);
  bumpContentVersion(db);
}

// ---- Entries -------------------------------------------------------------

function parseEntry(row) {
  if (!row) return null;
  return {
    ...row,
    data: JSON.parse(row.data),
    published_data: row.published_data ? JSON.parse(row.published_data) : null,
  };
}

export function listEntries(db, collectionId) {
  return db
    .prepare('SELECT id, slug, status, data, updated_at, published_at FROM entries WHERE collection_id = ? ORDER BY updated_at DESC')
    .all(collectionId)
    .map((r) => ({ ...r, data: JSON.parse(r.data) }));
}

// Row label: trimmed value of the collection's first field with content,
// else the entry's UUID. Entries have no built-in title on purpose: the CMS
// also stores things (wallpapers, stats, arbitrary JSON) that have none.
export function entryLabel(entry, collection) {
  for (const f of collection.fields) {
    const v = entry.data?.[f.name];
    if (v === undefined || v === null || v === '' || typeof v === 'boolean') continue;
    const text = (typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/\s+/g, ' ').trim();
    if (text) return text.length > 80 ? `${text.slice(0, 80)}\u2026` : text;
  }
  return entry.slug;
}

export function getEntry(db, collectionId, slug) {
  return parseEntry(db.prepare('SELECT * FROM entries WHERE collection_id = ? AND slug = ?').get(collectionId, slug));
}

export function getEntryById(db, id) {
  return parseEntry(db.prepare('SELECT * FROM entries WHERE id = ?').get(id));
}

export function createEntry(db, collection, { data }) {
  const slug = randomUUID();
  const info = db
    .prepare('INSERT INTO entries (collection_id, slug, data) VALUES (?, ?, ?)')
    .run(collection.id, slug, JSON.stringify(data));
  return getEntryById(db, info.lastInsertRowid);
}

// Updates an entry, recording a backward field-level delta as a revision:
// only fields whose value changed are stored, holding the PREVIOUS value.
export function updateEntry(db, entry, { data }) {
  const delta: Record<string, any> = {};
  const fieldNames = new Set([...Object.keys(entry.data), ...Object.keys(data)]);
  for (const name of fieldNames) {
    const before = entry.data[name];
    const after = data[name];
    if (JSON.stringify(before) !== JSON.stringify(after)) delta[name] = before ?? null;
  }
  if (Object.keys(delta).length === 0) return getEntryById(db, entry.id);

  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO revisions (entry_id, changed) VALUES (?, ?)').run(entry.id, JSON.stringify(delta));
    db.prepare("UPDATE entries SET data = ?, updated_at = datetime('now') WHERE id = ?").run(
      JSON.stringify(data),
      entry.id,
    );
    pruneRevisions(db, entry.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getEntryById(db, entry.id);
}

export function publishEntry(db, entryId) {
  const entry = getEntryById(db, entryId);
  if (!entry) return null;
  const snapshot = { slug: entry.slug, ...entry.data };
  db.prepare(
    "UPDATE entries SET status = 'published', published_data = ?, published_at = datetime('now') WHERE id = ?",
  ).run(JSON.stringify(snapshot), entryId);
  bumpContentVersion(db);
  return getEntryById(db, entryId);
}

export function unpublishEntry(db, entryId) {
  db.prepare("UPDATE entries SET status = 'draft', published_data = NULL, published_at = NULL WHERE id = ?").run(entryId);
  bumpContentVersion(db);
}

export function deleteEntry(db, entryId) {
  db.prepare('DELETE FROM entries WHERE id = ?').run(entryId);
  bumpContentVersion(db);
}

// ---- Revisions -----------------------------------------------------------

export function listRevisions(db, entryId) {
  return db
    .prepare('SELECT id, changed, created_at FROM revisions WHERE entry_id = ? ORDER BY id DESC')
    .all(entryId)
    .map((r) => ({ ...r, changed: JSON.parse(r.changed) }));
}

// Keep the newest REVISIONS_KEEP and drop anything older than the age cap.
function pruneRevisions(db, entryId) {
  db.prepare(
    `DELETE FROM revisions WHERE entry_id = ? AND id NOT IN (
       SELECT id FROM revisions WHERE entry_id = ? ORDER BY id DESC LIMIT ?
     )`,
  ).run(entryId, entryId, REVISIONS_KEEP);
  db.prepare("DELETE FROM revisions WHERE entry_id = ? AND created_at < datetime('now', ?)").run(
    entryId,
    `-${REVISIONS_MAX_AGE_DAYS} days`,
  );
}

// Atomic revert: reconstruct the entry state as it was BEFORE the given
// revision by applying backward deltas from newest down to (and including)
// that revision, inside one transaction. The revert itself is saved as a
// normal revision, so it can be reverted too.
export function revertToRevision(db, entry, revisionId) {
  const revisions = db
    .prepare('SELECT id, changed FROM revisions WHERE entry_id = ? AND id >= ? ORDER BY id DESC')
    .all(entry.id, revisionId);
  if (revisions.length === 0 || revisions[revisions.length - 1].id !== revisionId) {
    throw new Error('Revision not found for this entry.');
  }
  const data = { ...entry.data };
  for (const rev of revisions) {
    const changed = JSON.parse(rev.changed);
    for (const [field, previous] of Object.entries(changed)) {
      if (field === '__title') continue; // legacy key from before titles were removed
      if (previous === null) delete data[field];
      else data[field] = previous;
    }
  }
  return updateEntry(db, entry, { data });
}

// ---- API keys ------------------------------------------------------------

function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

// Returns the plaintext key exactly once; only the hash is stored.
export function createApiKey(db, name) {
  const key = `yn_${randomToken(24)}`;
  db.prepare('INSERT INTO api_keys (name, key_hash) VALUES (?, ?)').run(name, hashKey(key));
  return key;
}

export function listApiKeys(db) {
  return db.prepare('SELECT id, name, created_at, last_used_at FROM api_keys ORDER BY id').all();
}

export function revokeApiKey(db, id) {
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
}

export function verifyApiKey(db, key) {
  if (!key) return false;
  const row = db.prepare('SELECT id FROM api_keys WHERE key_hash = ?').get(hashKey(key));
  if (!row) return false;
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return true;
}

// ---- Published read path (API) -------------------------------------------

export function listPublished(db, collectionId, { limit = 50, offset = 0 } = {}) {
  return db
    .prepare(
      `SELECT slug, published_data, published_at FROM entries
       WHERE collection_id = ? AND status = 'published'
       ORDER BY published_at DESC LIMIT ? OFFSET ?`,
    )
    .all(collectionId, Math.min(limit, 100), offset)
    .map((r) => ({ ...JSON.parse(r.published_data), published_at: r.published_at }));
}

export function getPublished(db, collectionId, slug) {
  const row = db
    .prepare("SELECT published_data, published_at FROM entries WHERE collection_id = ? AND slug = ? AND status = 'published'")
    .get(collectionId, slug);
  if (!row) return null;
  return { ...JSON.parse(row.published_data), published_at: row.published_at };
}
