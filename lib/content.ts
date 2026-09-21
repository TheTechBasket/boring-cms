// Query layer over a project database: collections, entries, publish
// materialization, field-delta revisions with atomic revert, API keys.

import { createHash, createHmac, randomUUID } from 'node:crypto';
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
  counter: { value: 'object {up, down} (server-managed, never stored in entry data; bump via the counter endpoint)', options: { access: '"public" (default, anyone may vote, one vote per visitor) or "key" (a write API key is required to bump).' } },
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

// ---- Bulk cosmetic ref rewrite -------------------------------------------

// Escape a literal string for safe use inside a RegExp alternation.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Swaps exact URL strings across every entry (published_data and the draft
// data), in one transaction. Deliberately does NOT write updated_at or
// published_at: this is a cosmetic swap of the same asset (e.g. .png ->
// .webp), so it must not move sitemap lastmod. Relies on there being no
// UPDATE trigger on entries (there is none) so updated_at stays put; a single
// content_version bump forces exactly one API refetch on the next build.
// Matching is exact literal: every old URL is escapeRegExp'd before going into
// the alternation, so a % or _ or . in a URL matches itself, never a wildcard.
// Draft data (published_data NULL) is rewritten too so a later publish carries
// the new URL; the NULL checks skip rows that have no published/draft blob.
export function bulkRewriteRefs(db, pairs, { dryRun = false } = {}) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error('pairs must be a non-empty array of {old, new}.');
  }
  for (const p of pairs) {
    const oldUrl = p?.old;
    const newUrl = p?.new;
    if (typeof oldUrl !== 'string' || typeof newUrl !== 'string' || !oldUrl || !newUrl) {
      throw new Error('Each pair needs non-empty string old and new.');
    }
    if (!oldUrl.startsWith('https://') || !newUrl.startsWith('https://')) {
      throw new Error('Both old and new must be full https:// URLs (never a bare extension like ".png").');
    }
    if (oldUrl === newUrl) throw new Error(`Pair is a no-op: old === new (${oldUrl}).`);
  }

  // Single pass over entries, independent of pair count. The old code ran one
  // full-table instr() scan PER pair (no index can serve a substring match),
  // so a 2216-pair map meant 2216 scans and a gateway timeout. Here every
  // entry's text is scanned once by a combined literal matcher (alternation of
  // all old URLs), and live writes go by primary key, not another full scan.
  // Replacement is non-cascading by design: each matched URL is swapped exactly
  // once, so a pair whose new value equals another pair's old value does not
  // chain. That matches "swap exact full URLs" and is the original intent.
  const map = new Map(pairs.map((p) => [p.old, p.new]));
  // Longest-first so a URL that is a prefix of another can't shadow the longer.
  const olds = [...map.keys()].sort((a, b) => b.length - a.length);
  const rx = new RegExp(olds.map(escapeRegExp).join('|'), 'g');
  const matched = new Map(olds.map((o) => [o, 0])); // distinct entries per old URL

  let entriesTouched = 0;
  const changes = []; // {id, published_data, data} for the live write, changed rows only
  // ponytail: .iterate() streams so we never hold all entries in memory (small
  // hosts run tight); only changed rows are buffered for the write.
  for (const row of db.prepare('SELECT id, published_data, data FROM entries').iterate()) {
    const seen = new Set();
    const swap = (m) => { seen.add(m); return map.get(m); };
    const pub = row.published_data == null ? row.published_data : row.published_data.replace(rx, swap);
    const data = row.data == null ? row.data : row.data.replace(rx, swap);
    if (seen.size === 0) continue; // no match in either blob
    for (const m of seen) matched.set(m, matched.get(m) + 1);
    entriesTouched++;
    if (!dryRun) changes.push({ id: row.id, published_data: pub, data });
  }
  const per = pairs.map((p) => ({ old: p.old, new: p.new, matched: matched.get(p.old) }));

  if (dryRun) return { dry_run: true, entries_touched: entriesTouched, content_version_bumped: false, pairs: per };

  const upd = db.prepare('UPDATE entries SET published_data = ?, data = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const c of changes) upd.run(c.published_data, c.data, c.id);
    if (entriesTouched > 0) bumpContentVersion(db);
    db.prepare('INSERT INTO ref_rewrites (pair_count, entries_touched, pairs) VALUES (?, ?, ?)')
      .run(pairs.length, entriesTouched, JSON.stringify(pairs));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { dry_run: false, entries_touched: entriesTouched, content_version_bumped: entriesTouched > 0, pairs: per };
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

export function addCollectionField(db, collectionSlug, { label, type, name: requestedName = '', required = false, unique = false, access = '' }: any) {
  const collection = getCollection(db, collectionSlug);
  if (!collection) return null;
  if (!FIELD_TYPES.includes(type)) throw new Error(`Unknown field type: ${type}`);
  // Explicit field id wins over auto-slugified label; both still dodge
  // reserved names and duplicates by suffixing.
  const name = uniqueSlug(slugify(String(requestedName).trim() || label), (s) => RESERVED_FIELD_NAMES.has(s) || collection.fields.some((f) => f.name === s));
  const field: Record<string, any> = { name, label, type };
  if (required) field.required = true;
  if (unique) field.unique = true;
  if (type === 'counter' && access === 'key') field.access = 'key';
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
      if (k === 'access' && (v === 'public' || next.type !== 'counter')) continue;
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
    if (f.type === 'counter') continue;
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

// How many entries carry a real value for a field, and how unique those
// values are. Shown before a field delete so its impact is visible.
export function fieldUsage(db, collectionId, fieldName) {
  const path = `$.${fieldName}`;
  const total = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE collection_id = ?').get(collectionId).n;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS filled, COUNT(DISTINCT json_extract(data, ?)) AS distinct_
         FROM entries
        WHERE collection_id = ?
          AND json_extract(data, ?) IS NOT NULL
          AND json_extract(data, ?) != ''`,
    )
    .get(path, collectionId, path, path);
  return { total, filled: row.filled, distinct: row.distinct_ };
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

// Counter totals live in the counters table. A counter-named key in written
// data would otherwise persist and leak into the public snapshot.
function stripCounters(fields, data) {
  const out = { ...data };
  for (const f of fields) if (f.type === 'counter') delete out[f.name];
  return out;
}

export function createEntry(db, collection, { data, slug: requestedSlug = undefined }: { data: any; slug?: string }) {
  data = stripCounters(collection.fields, data);
  const exists = (s) => !!getEntry(db, collection.id, s);
  const slug = requestedSlug ? uniqueSlug(slugify(requestedSlug), exists) : randomUUID();
  const info = db
    .prepare('INSERT INTO entries (collection_id, slug, data) VALUES (?, ?, ?)')
    .run(collection.id, slug, JSON.stringify(data));
  return getEntryById(db, info.lastInsertRowid);
}

// Updates an entry, recording a backward field-level delta as a revision:
// only fields whose value changed are stored, holding the PREVIOUS value.
export function updateEntry(db, entry, { data, preserveTimestamps = false }: { data: any; preserveTimestamps?: boolean }) {
  const col = db.prepare('SELECT fields, revisions_keep FROM collections WHERE id = ?').get(entry.collection_id);
  data = stripCounters(JSON.parse(col.fields), data);
  const delta: Record<string, any> = {};
  const fieldNames = new Set([...Object.keys(entry.data), ...Object.keys(data)]);
  for (const name of fieldNames) {
    const before = entry.data[name];
    const after = data[name];
    if (JSON.stringify(before) !== JSON.stringify(after)) delta[name] = before ?? null;
  }
  if (Object.keys(delta).length === 0) return getEntryById(db, entry.id);

  const keep = col.revisions_keep ?? REVISIONS_KEEP;

  // Savepoint instead of BEGIN so batch callers can hold an outer transaction.
  db.exec('SAVEPOINT update_entry');
  try {
    if (keep > 0) db.prepare('INSERT INTO revisions (entry_id, changed) VALUES (?, ?)').run(entry.id, JSON.stringify(delta));
    db.prepare(preserveTimestamps ? 'UPDATE entries SET data = ? WHERE id = ?' : "UPDATE entries SET data = ?, updated_at = datetime('now') WHERE id = ?").run(
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

// at: optional go-live time (ISO 8601 or "YYYY-MM-DD HH:MM:SS", UTC). A future
// value keeps the entry status 'published' but hidden from the API until then;
// the read path gates on published_at <= now, so no timer or extra status.
export function publishEntry(db, entryId, { preserveTimestamps = false, at = '' }: { preserveTimestamps?: boolean; at?: string } = {}) {
  const entry = getEntryById(db, entryId);
  if (!entry) return null;
  if (at && Number.isNaN(new Date(at).getTime())) throw new Error('Invalid publish date.');
  const snapshot = { slug: entry.slug, ...entry.data };
  // A user schema field named "slug" left empty must not wipe the native
  // slug out of the API snapshot; a filled one wins on purpose.
  if (snapshot.slug === '' || snapshot.slug === null || snapshot.slug === undefined) snapshot.slug = entry.slug;
  // ponytail: first-time publish always stamps; preserve only re-publishes
  // A republish must not pull a still-scheduled entry live early.
  const keepTimestamp = !at && entry.published_at && (preserveTimestamps || entryState('published', entry.published_at) === 'scheduled');
  if (at) {
    db.prepare("UPDATE entries SET status = 'published', published_data = ?, published_at = ? WHERE id = ?").run(JSON.stringify(snapshot), sqlUtc(at), entryId);
  } else {
    db.prepare(
      keepTimestamp
        ? "UPDATE entries SET status = 'published', published_data = ? WHERE id = ?"
        : "UPDATE entries SET status = 'published', published_data = ?, published_at = datetime('now') WHERE id = ?",
    ).run(JSON.stringify(snapshot), entryId);
  }
  bumpContentVersion(db);
  return getEntryById(db, entryId);
}

// True when a published entry's draft data differs from what the API is
// currently serving, i.e. a republish is pending. Draft-only entries return
// false: they are simply unpublished, not "changed since publish".
export function hasUnpublishedChanges(entry) {
  if (!entry || entry.status !== 'published' || !entry.published_data) return false;
  const snapshot: Record<string, any> = { slug: entry.slug, ...entry.data };
  if (!snapshot.slug) snapshot.slug = entry.slug;
  return JSON.stringify(snapshot) !== JSON.stringify(entry.published_data);
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
export function createApiKey(db, name, scope = 'read', mcp = false) {
  const key = `yn_${randomToken(24)}`;
  db.prepare('INSERT INTO api_keys (name, key_hash, scope, mcp) VALUES (?, ?, ?, ?)').run(name, hashKey(key), scope === 'write' ? 'write' : 'read', mcp ? 1 : 0);
  return key;
}

export function listApiKeys(db) {
  return db.prepare('SELECT id, name, scope, mcp, created_at, last_used_at FROM api_keys ORDER BY id').all();
}

export function revokeApiKey(db, id) {
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
}

export function setApiKeyMcp(db, id, mcp) {
  db.prepare('UPDATE api_keys SET mcp = ? WHERE id = ?').run(mcp ? 1 : 0, id);
}

// Truthy result carries { id, scope, mcp } for scope/MCP checks and rate limiting.
export function verifyApiKey(db, key) {
  if (!key) return null;
  const row = db.prepare('SELECT id, scope, mcp, last_used_at FROM api_keys WHERE key_hash = ?').get(hashKey(key));
  if (!row) return null;
  // last_used_at is informational: write it at most once a minute instead of
  // a WAL write on every API read.
  if (!row.last_used_at || row.last_used_at < new Date(Date.now() - Number(process.env.LAST_USED_MS ?? 60000)).toISOString().slice(0, 19).replace('T', ' ')) {
    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  }
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
// Entries published with a future go-live time, soonest first. Admin/write-key
// view: the public read path never returns these.
export function listScheduled(db, collectionId, { limit = 50 }: any = {}) {
  return db
    .prepare(
      `SELECT slug, published_at, updated_at FROM entries
       WHERE collection_id = ? AND status = 'published' AND published_at > datetime('now')
       ORDER BY published_at ASC LIMIT ?`,
    )
    .all(collectionId, Math.min(limit, 100))
    .map((r) => ({ slug: r.slug, publish_at: isoUtc(r.published_at), updated_at: isoUtc(r.updated_at) }));
}

export function listPublished(db, collectionId, { limit = 50, offset = 0, updatedSince = '' }: any = {}) {
  const where = ["collection_id = ? AND status = 'published' AND published_at <= datetime('now')"];
  const args: any[] = [collectionId];
  // published_at counts too: an entry that went live after the cursor was
  // taken (scheduled) has an old updated_at and would otherwise be skipped.
  if (updatedSince) { const c = sqlUtc(updatedSince); where.push('(updated_at > ? OR published_at > ?)'); args.push(c, c); }
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

// Entries published with a future date. Folded into the API ETag so a cached
// list refreshes the moment one goes live (time passing does not bump
// content_version). Index range scan over future rows only: near-free.
// slug -> id for the API hot path, valid for one content_version. Every path
// that adds/removes a collection or swaps its id bumps the version.
const collIdCache = new WeakMap<object, { v: string; ids: Map<string, number> }>();
export function collectionIdBySlug(db, slug, ver) {
  let e = collIdCache.get(db);
  if (!e || e.v !== ver) collIdCache.set(db, (e = { v: ver, ids: new Map() }));
  let id = e.ids.get(slug);
  if (id === undefined) {
    id = db.prepare('SELECT id FROM collections WHERE slug = ?').get(slug)?.id;
    if (id === undefined) return null;
    e.ids.set(slug, id);
  }
  return id;
}

const schedCache = new WeakMap<object, Map<number, { v: string; times: string[]; key: string; tag: string }>>();
// Opaque API ETag: HMAC of (content_version, still-scheduled count). Version
// bumps refresh the future timestamps; between bumps only time passing flips
// the count, so the tag flips exactly when a scheduled entry goes live. The
// HMAC keeps write frequency and the number of hidden scheduled entries from
// leaking to read-key holders through the tag. Memoized: per request cost is
// a compare unless (version, count) moved.
export function apiEtag(db, collectionId, ver, secret) {
  let m = schedCache.get(db);
  if (!m) schedCache.set(db, (m = new Map()));
  let e = m.get(collectionId);
  if (!e || e.v !== ver) {
    const times = db.prepare("SELECT published_at FROM entries WHERE collection_id = ? AND status = 'published' AND published_at > datetime('now')").all(collectionId).map((r) => r.published_at);
    m.set(collectionId, (e = { v: ver, times, key: '', tag: '' }));
  }
  let n = 0;
  if (e.times.length) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (const t of e.times) if (t > now) n++;
  }
  const key = `${ver}.${n}`;
  if (e.key !== key) {
    e.key = key;
    e.tag = `"${createHmac('sha256', secret).update(`etag:${key}`).digest('base64url').slice(0, 16)}"`;
  }
  return e.tag;
}

// Publish date from an export dump, only when it is still in the future, so a
// restore or import keeps an entry scheduled instead of publishing it now.
export function futureAt(ts) {
  return ts && new Date(ts).getTime() > Date.now() ? String(ts) : '';
}

// Display state for admin: published with a future date is 'scheduled'.
export function entryState(status, publishedAt) {
  return status === 'published' && publishedAt && publishedAt > new Date().toISOString().slice(0, 19).replace('T', ' ') ? 'scheduled' : status;
}

export function getPublished(db, collectionId, slug) {
  const row = db
    .prepare("SELECT slug, published_data, published_at, updated_at FROM entries WHERE collection_id = ? AND slug = ? AND status = 'published' AND published_at <= datetime('now')")
    .get(collectionId, slug);
  if (!row) return null;
  const item = { published_at: isoUtc(row.published_at), ...JSON.parse(row.published_data), updated_at: isoUtc(row.updated_at) };
  if (!item.slug) item.slug = row.slug;
  return item;
}
