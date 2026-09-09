// Query layer over a project database: collections, entries, publish
// materialization, field-delta revisions with atomic revert, API keys.

import { createHash, randomUUID } from 'node:crypto';
import { randomToken } from './crypto.ts';

// Single source of truth for the type system. FIELD_TYPES, FIELD_OPTIONS and
// the API's field-type introspection (describeFieldTypes) all derive from this
// registry, so a new type added here shows up everywhere at once.
// Options are stored inside the collection's fields JSON; only set values are
// stored, absence means "no constraint".
export const UNIVERSAL_FIELD_OPTIONS = {
  required: 'Reject empty values on save.',
  unique: 'Value must be unique across entries in the collection.',
  help: 'Help text shown under the input in the editor.',
  placeholder: 'Input placeholder in the editor.',
  default: 'Default value pre-filled for new entries.',
};

const LENGTH_OPTIONS = {
  minlength: 'Minimum length in characters.',
  maxlength: 'Maximum length in characters.',
  pattern: 'Regex the whole value must match (anchored).',
};

export const FIELD_TYPE_DEFS = {
  text: { value: 'string', options: { ...LENGTH_OPTIONS } },
  markdown: { value: 'string (Markdown source)', options: { ...LENGTH_OPTIONS } },
  number: { value: 'number', options: { min: 'Minimum value.', max: 'Maximum value.', step: 'Editor input step (not validated server-side).' } },
  boolean: { value: 'boolean', options: {} },
  date: { value: 'string "YYYY-MM-DD"', options: { min: 'Earliest date (YYYY-MM-DD).', max: 'Latest date (YYYY-MM-DD).' } },
  datetime: { value: 'string ISO 8601 UTC "YYYY-MM-DDTHH:MM:SSZ"', options: { min: 'Earliest datetime (same format).', max: 'Latest datetime (same format).' } },
  json: { value: 'any JSON value', options: {} },
  image: { value: 'string (media path or URL)', options: { ...LENGTH_OPTIONS, accept: 'Accept list for the editor file picker, e.g. "image/*".' } },
  relation: { value: 'string entry slug, or array of slugs when multiple', options: { collection: 'Target collection slug (required for relations).', multiple: 'Allow multiple related entries (value becomes an array).' } },
};

export const FIELD_TYPES = Object.keys(FIELD_TYPE_DEFS);

export const FIELD_OPTIONS = [
  ...new Set([
    ...Object.keys(UNIVERSAL_FIELD_OPTIONS),
    ...FIELD_TYPES.flatMap((t) => Object.keys(FIELD_TYPE_DEFS[t].options)),
  ]),
];

// Option names that apply to a given type (universal + type-specific).
export function validOptionsFor(type) {
  return new Set([...Object.keys(UNIVERSAL_FIELD_OPTIONS), ...Object.keys(FIELD_TYPE_DEFS[type]?.options ?? {})]);
}

// Introspection payload for the API/MCP surface: every type with its value
// shape and the full option set (universal + type-specific) it accepts.
export function describeFieldTypes() {
  return {
    types: Object.fromEntries(
      FIELD_TYPES.map((t) => [t, { value: FIELD_TYPE_DEFS[t].value, options: { ...UNIVERSAL_FIELD_OPTIONS, ...FIELD_TYPE_DEFS[t].options } }]),
    ),
    reserved_field_names: [...RESERVED_FIELD_NAMES],
  };
}

// Default retention; a collection can override keep via revisions_keep
// (NULL = default, 0 = revisions off for frequently rewritten collections).
export const REVISIONS_KEEP = 2;
const REVISIONS_MAX_AGE_DAYS = 15;

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

// ---- Project meta (plain key/value, no encryption) ------------------------

export function getMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
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

// Field names the system writes itself in API output. A user field with one
// of these names either gets shadowed (slug, updated_at) or shadows a system
// value, so the builder never mints them; imports may still carry them and
// the read path defends per name.
export const RESERVED_FIELD_NAMES = new Set(['slug', 'updated_at', 'published_at']);

export function addCollectionField(db, collectionSlug, { label, type, name: requestedName = '', required = false, unique = false }) {
  const collection = getCollection(db, collectionSlug);
  if (!collection) return null;
  if (!FIELD_TYPES.includes(type)) throw new Error(`Unknown field type: ${type}`);
  // Explicit field id wins over auto-slugified label; both still dodge
  // reserved names and duplicates by suffixing.
  const name = uniqueSlug(slugify(String(requestedName).trim() || label), (s) => RESERVED_FIELD_NAMES.has(s) || collection.fields.some((f) => f.name === s));
  const field: Record<string, any> = { name, label, type };
  if (required) field.required = true;
  if (unique) field.unique = true;
  const fields = [...collection.fields, field];
  db.prepare('UPDATE collections SET fields = ? WHERE id = ?').run(JSON.stringify(fields), collection.id);
  return getCollection(db, collectionSlug);
}

// keep: null clears the override (use default), integer >= 0 sets it (0 = off).
export function setCollectionRevisions(db, collectionSlug, keep) {
  const collection = getCollection(db, collectionSlug);
  if (!collection) return null;
  db.prepare('UPDATE collections SET revisions_keep = ? WHERE id = ?').run(keep, collection.id);
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

// Updates a field's label, type and options. The name (data key) is
// immutable so existing entry data keeps pointing at the same key.
export function updateCollectionField(db, collectionSlug, fieldName, props) {
  const collection = getCollection(db, collectionSlug);
  if (!collection) return null;
  const fields = collection.fields.map((f) => {
    if (f.name !== fieldName) return f;
    const next: Record<string, any> = {
      name: f.name,
      label: (props.label || '').trim() || f.label,
      type: FIELD_TYPES.includes(props.type) ? props.type : f.type,
    };
    for (const k of FIELD_OPTIONS) {
      const v = props[k];
      if (v === undefined || v === null || v === '' || v === false) continue;
      next[k] = v;
    }
    return next;
  });
  db.prepare('UPDATE collections SET fields = ? WHERE id = ?').run(JSON.stringify(fields), collection.id);
  return getCollection(db, collectionSlug);
}

// Server-side enforcement of field options. Returns human-readable error
// strings; empty array means the data is valid. Pass db (and excludeEntryId
// for edits/upserts) to also enforce unique fields; without db the unique
// check is skipped.
export function validateEntryData(collection, data, { db = null, excludeEntryId = 0 }: any = {}) {
  const errors: string[] = [];
  for (const f of collection.fields) {
    const v = data[f.name];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (f.required && (empty || v === false)) {
      errors.push(`${f.label} is required.`);
      continue;
    }
    if (empty) continue;
    if (f.unique && db && (typeof v === 'string' || typeof v === 'number')) {
      const dup = db
        .prepare('SELECT slug FROM entries WHERE collection_id = ? AND id != ? AND json_extract(data, ?) = ? LIMIT 1')
        .get(collection.id, excludeEntryId, `$.${f.name}`, v);
      if (dup) errors.push(`${f.label} must be unique; "${v}" is already used by entry ${dup.slug}.`);
    }
    if (f.type === 'number') {
      if (typeof v !== 'number' || Number.isNaN(v)) errors.push(`${f.label} must be a number.`);
      else {
        if (f.min !== undefined && v < Number(f.min)) errors.push(`${f.label} must be at least ${f.min}.`);
        if (f.max !== undefined && v > Number(f.max)) errors.push(`${f.label} must be at most ${f.max}.`);
      }
    } else if (f.type === 'text' || f.type === 'markdown' || f.type === 'image') {
      const s = String(v);
      if (f.minlength && s.length < Number(f.minlength)) errors.push(`${f.label} must be at least ${f.minlength} characters.`);
      if (f.maxlength && s.length > Number(f.maxlength)) errors.push(`${f.label} must be at most ${f.maxlength} characters.`);
      if (f.pattern) {
        try {
          if (!new RegExp(`^(?:${f.pattern})$`).test(s)) errors.push(`${f.label} does not match the required pattern.`);
        } catch {
          // invalid stored pattern never blocks saving
        }
      }
    } else if (f.type === 'date') {
      const s = String(v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) errors.push(`${f.label} must be a date (YYYY-MM-DD).`);
      else {
        if (f.min && s < f.min) errors.push(`${f.label} must be on or after ${f.min}.`);
        if (f.max && s > f.max) errors.push(`${f.label} must be on or before ${f.max}.`);
      }
    } else if (f.type === 'datetime') {
      const s = String(v);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s)) {
        errors.push(`${f.label} must be an ISO 8601 UTC datetime (YYYY-MM-DDTHH:MM:SSZ).`);
      } else {
        if (f.min && s < f.min) errors.push(`${f.label} must be on or after ${f.min}.`);
        if (f.max && s > f.max) errors.push(`${f.label} must be on or before ${f.max}.`);
      }
    }
  }
  return errors;
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

// q: matched against the entry's raw JSON data and slug (substring, case-insensitive).
// status: 'draft' | 'published' exact match.
export function listEntries(db, collectionId, { limit = 50, offset = 0, q = '', status = '' }: any = {}) {
  const where = ['collection_id = ?'];
  const args: any[] = [collectionId];
  if (q) { where.push('(data LIKE ? ESCAPE \'\\\' OR slug LIKE ? ESCAPE \'\\\')'); const like = `%${likeEscape(q)}%`; args.push(like, like); }
  if (status) { where.push('status = ?'); args.push(status); }
  return db
    .prepare(`SELECT id, slug, status, data, updated_at, published_at FROM entries WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset)
    .map((r) => ({ ...r, data: JSON.parse(r.data) }));
}

export function countEntries(db, collectionId, { q = '', status = '' }: any = {}) {
  const where = ['collection_id = ?'];
  const args: any[] = [collectionId];
  if (q) { where.push('(data LIKE ? ESCAPE \'\\\' OR slug LIKE ? ESCAPE \'\\\')'); const like = `%${likeEscape(q)}%`; args.push(like, like); }
  if (status) { where.push('status = ?'); args.push(status); }
  return db.prepare(`SELECT COUNT(*) AS n FROM entries WHERE ${where.join(' AND ')}`).get(...args).n;
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
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

export function createEntry(db, collection, { data, slug: requestedSlug = undefined }: { data: any; slug?: string }) {
  const exists = (s) => !!getEntry(db, collection.id, s);
  const slug = requestedSlug ? uniqueSlug(slugify(requestedSlug), exists) : randomUUID();
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

  const keep = db.prepare('SELECT revisions_keep FROM collections WHERE id = ?').get(entry.collection_id)?.revisions_keep ?? REVISIONS_KEEP;

  // Savepoint instead of BEGIN so batch callers can hold an outer transaction.
  db.exec('SAVEPOINT update_entry');
  try {
    if (keep > 0) db.prepare('INSERT INTO revisions (entry_id, changed) VALUES (?, ?)').run(entry.id, JSON.stringify(delta));
    db.prepare("UPDATE entries SET data = ?, updated_at = datetime('now') WHERE id = ?").run(
      JSON.stringify(data),
      entry.id,
    );
    pruneRevisions(db, entry.id, keep);
    db.exec('RELEASE update_entry');
  } catch (err) {
    db.exec('ROLLBACK TO update_entry');
    db.exec('RELEASE update_entry');
    throw err;
  }
  return getEntryById(db, entry.id);
}

// Renames an entry's native slug (the public id in API URLs). Returns the
// slug actually applied (collision-suffixed). The published snapshot's slug
// follows along unless a user schema field deliberately set a different one.
export function renameEntry(db, entry, requestedSlug) {
  const wanted = slugify(String(requestedSlug));
  if (!wanted || wanted === entry.slug) return entry.slug;
  const slug = uniqueSlug(wanted, (s) => !!db.prepare('SELECT 1 FROM entries WHERE collection_id = ? AND slug = ? AND id != ?').get(entry.collection_id, s, entry.id));
  db.prepare('UPDATE entries SET slug = ? WHERE id = ?').run(slug, entry.id);
  if (entry.published_data && entry.published_data.slug === entry.slug) {
    db.prepare("UPDATE entries SET published_data = json_set(published_data, '$.slug', ?) WHERE id = ?").run(slug, entry.id);
  }
  if (entry.status === 'published') bumpContentVersion(db); // API URL changed
  return slug;
}

export function publishEntry(db, entryId) {
  const entry = getEntryById(db, entryId);
  if (!entry) return null;
  const snapshot = { slug: entry.slug, ...entry.data };
  // A user schema field named "slug" left empty must not wipe the native
  // slug out of the API snapshot; a filled one wins on purpose.
  if (snapshot.slug === '' || snapshot.slug === null || snapshot.slug === undefined) snapshot.slug = entry.slug;
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

// Keep the newest `keep` and drop anything older than the age cap.
// keep = 0 means "revisions off": existing history is left to age out
// rather than wiped retroactively.
function pruneRevisions(db, entryId, keep = REVISIONS_KEEP) {
  if (keep > 0) db.prepare(
    `DELETE FROM revisions WHERE entry_id = ? AND id NOT IN (
       SELECT id FROM revisions WHERE entry_id = ? ORDER BY id DESC LIMIT ?
     )`,
  ).run(entryId, entryId, keep);
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
export function createApiKey(db, name, scope = 'read') {
  const key = `yn_${randomToken(24)}`;
  db.prepare('INSERT INTO api_keys (name, key_hash, scope) VALUES (?, ?, ?)').run(name, hashKey(key), scope === 'write' ? 'write' : 'read');
  return key;
}

export function listApiKeys(db) {
  return db.prepare('SELECT id, name, scope, created_at, last_used_at FROM api_keys ORDER BY id').all();
}

export function revokeApiKey(db, id) {
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
}

// Truthy result carries { id, scope } for scope checks and rate limiting.
export function verifyApiKey(db, key) {
  if (!key) return null;
  const row = db.prepare('SELECT id, scope FROM api_keys WHERE key_hash = ?').get(hashKey(key));
  if (!row) return null;
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return row;
}

// ---- Published read path (API) -------------------------------------------

// Row clocks are stored as SQLite "YYYY-MM-DD HH:MM:SS" (UTC). Consumers get
// ISO 8601 with Z so JS Date never misparses them as local time.
export function isoUtc(ts) {
  return typeof ts === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts) ? ts.replace(' ', 'T') + 'Z' : ts;
}

// Incoming timestamps (updated_since) normalize to the stored SQL format.
// Bare "YYYY-MM-DD HH:MM:SS" is taken as UTC as-is; anything else (ISO with
// Z, fractional seconds, or an offset) goes through Date so the comparison
// is a real timestamp comparison, not a string accident.
function sqlUtc(ts) {
  const s = String(ts);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.replace('T', ' ').replace(/Z$/, '') : d.toISOString().slice(0, 19).replace('T', ' ');
}

// updatedSince: ISO/SQLite timestamp; only entries touched after it (draft
// edits count, so incremental pulls see upcoming changes after republish).
export function listPublished(db, collectionId, { limit = 50, offset = 0, updatedSince = '' }: any = {}) {
  const where = ["collection_id = ? AND status = 'published'"];
  const args: any[] = [collectionId];
  if (updatedSince) { where.push('updated_at > ?'); args.push(sqlUtc(updatedSince)); }
  return db
    .prepare(
      `SELECT slug, published_data, published_at, updated_at FROM entries
       WHERE ${where.join(' AND ')}
       ORDER BY published_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, Math.min(limit, 100), offset)
    // published_at here is the entries table's publish-lifecycle clock, kept
    // only as a fallback: a user-defined field of the same name (as ttb's
    // articles schema has) is real entry data and must win, not be shadowed.
    // updated_at is the opposite case: it is the cursor updated_since
    // filters on, so the row's write clock always wins over a same-named
    // data field (otherwise incremental pulls see stale values).
    .map((r) => {
      const item = { published_at: isoUtc(r.published_at), ...JSON.parse(r.published_data), updated_at: isoUtc(r.updated_at) };
      if (!item.slug) item.slug = r.slug; // pre-fix snapshots missing the native slug
      return item;
    });
}

export function getPublished(db, collectionId, slug) {
  const row = db
    .prepare("SELECT slug, published_data, published_at, updated_at FROM entries WHERE collection_id = ? AND slug = ? AND status = 'published'")
    .get(collectionId, slug);
  if (!row) return null;
  const item = { published_at: isoUtc(row.published_at), ...JSON.parse(row.published_data), updated_at: isoUtc(row.updated_at) };
  if (!item.slug) item.slug = row.slug;
  return item;
}
