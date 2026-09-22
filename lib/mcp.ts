// Per-project MCP endpoint: hand-rolled JSON-RPC 2.0 over plain HTTP POST
// (Streamable HTTP transport, JSON responses only, no SSE). The protocol
// surface we need is tiny; no SDK dependency.

import {
  listCollections,
  getCollection,
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  publishEntry,
  unpublishEntry,
  deleteEntry,
  hasUnpublishedChanges,
  validateEntryData,
  listPublished,
  listScheduled,
  entryState,
  getPublished,
  slugify,
  createCollection,
  addCollectionField,
  updateCollectionField,
  removeCollectionField,
  restoreCollectionField,
  checkSchemaHealth,
  SchemaImpactError,
  describeFieldTypes,
  validOptionsFor,
  bulkRewriteRefs,
  FIELD_TYPES,
  FIELD_OPTIONS,
} from './content.ts';
import { isoUtc } from './content.ts';
import { exportSchema, applySchema } from './transfer.ts';
import { APP_VERSION } from './views.ts';

const PROTOCOL_VERSION = '2025-03-26';

// ---- Rate limit: per-key token bucket, in memory ---------------------------
// ponytail: in-memory only, resets on restart; move to SQLite if multi-process ever happens.

export const DEFAULT_RATE_LIMIT = 60; // requests per minute per key, project can override via meta
export const MCP_BODY_LIMIT = 8 * 1024 * 1024; // bytes; 200 typical CMS entries easily pass 1MB
const buckets = new Map<string, { tokens: number; ts: number }>();

let lastSweep = 0;
export function rateLimitOk(bucketKey: string, limit = DEFAULT_RATE_LIMIT): boolean {
  const now = Date.now();
  // Drop buckets idle for a minute (they are full again anyway) so the map
  // cannot grow with every distinct caller.
  if (buckets.size > 10_000 && now - lastSweep > 30_000) {
    lastSweep = now;
    for (const [k, v] of buckets) if (now - v.ts > 60000) buckets.delete(k);
  }
  const b = buckets.get(bucketKey) ?? { tokens: limit, ts: now };
  b.tokens = Math.min(limit, b.tokens + ((now - b.ts) / 60000) * limit);
  b.ts = now;
  if (b.tokens < 1) {
    buckets.set(bucketKey, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(bucketKey, b);
  return true;
}

// Seconds until the bucket has one token again, for the 429 body. MCP
// clients read the JSON-RPC payload, not HTTP headers.
export function retryAfterSeconds(bucketKey: string, limit = DEFAULT_RATE_LIMIT): number {
  const b = buckets.get(bucketKey);
  if (!b || b.tokens >= 1) return 0;
  return Math.max(1, Math.ceil(((1 - b.tokens) / limit) * 60));
}

// Standard draft RateLimit-* headers for HTTP API responses. Reset is
// seconds until the bucket is full again (or until one token when empty).
export function rateLimitHeaders(bucketKey: string, limit = DEFAULT_RATE_LIMIT): Record<string, string> {
  const b = buckets.get(bucketKey);
  const tokens = b ? Math.min(limit, b.tokens + ((Date.now() - b.ts) / 60000) * limit) : limit;
  const remaining = Math.max(0, Math.floor(tokens));
  return {
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(remaining),
    'RateLimit-Reset': String(Math.ceil(((limit - tokens) / limit) * 60)),
  };
}

// Accept arrays/objects natively for json fields, and parse string values
// that are themselves JSON so older double-encoding clients keep working.
function normalizeJsonFields(collection, data) {
  const out = { ...data };
  for (const f of collection.fields) {
    if (f.type !== 'json') continue;
    const v = out[f.name];
    if (typeof v === 'string' && v.trim()) {
      try { out[f.name] = JSON.parse(v); } catch { /* not JSON, keep the string */ }
    }
  }
  return out;
}

// ---- Tools -----------------------------------------------------------------

const str = (desc: string) => ({ type: 'string', description: desc });
const bool = (desc: string) => ({ type: 'boolean', description: desc });

// Validates an options object against the registry for the given type.
// null option values pass through so update_field can clear an option.
function checkFieldOptions(type, options) {
  if (options == null) return {};
  if (typeof options !== 'object' || Array.isArray(options)) throw new ToolError('options must be an object.');
  const allowed = validOptionsFor(type);
  for (const k of Object.keys(options)) {
    if (!allowed.has(k)) throw new ToolError(`Option "${k}" does not apply to type "${type}". See describe_field_types.`);
  }
  return options;
}

// SchemaImpactError carries structured impact data; surface it as an
// actionable ToolError instead of a bare message so an agent caller knows to
// retry with force: true.
function rethrowImpact(err): never {
  if (!(err instanceof SchemaImpactError)) throw err;
  throw new ToolError(`${err.message} Retry with force: true if this is intentional.`);
}

const TOOLS = [
  {
    name: 'list_collections',
    description: 'List the collections in this project with their field schemas.',
    scope: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: (db) => listCollections(db).map((c) => ({ name: c.name, slug: c.slug, fields: c.fields })),
  },
  {
    name: 'list_entries',
    description: 'List published entries in a collection (same shape as the REST API). Items carry slug, updated_at and published_at for incremental sync; pass updated_since to fetch only entries changed after that timestamp.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('Collection slug'),
        limit: { type: 'number', description: 'Max entries (default 50, cap 100)' },
        offset: { type: 'number', description: 'Pagination offset' },
        updated_since: str('Only entries updated after this UTC timestamp (ISO 8601 or "YYYY-MM-DD HH:MM:SS")'),
      },
      required: ['collection'],
    },
    handler: (db, args, collection) => listPublished(db, collection.id, { limit: args.limit ?? 50, offset: args.offset ?? 0, updatedSince: args.updated_since ?? '' }),
  },
  {
    name: 'list_scheduled',
    description: 'List entries scheduled to go live (published with a future time, hidden from the public API until then), soonest first. Read one with get_entry draft: true; change the time with publish_entry at; cancel with unpublish_entry.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { collection: str('Collection slug'), limit: { type: 'number', description: 'Max entries (default 50, cap 100)' } },
      required: ['collection'],
    },
    handler: (db, args, collection) => listScheduled(db, collection.id, { limit: args.limit ?? 50 }),
  },
  {
    name: 'get_entry',
    description: 'Get one published entry by slug. Pass draft: true to get the latest saved (draft) version instead, which also reports has_unpublished_changes: true when a published entry has edits not yet republished.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('Collection slug'),
        slug: str('Entry slug'),
        draft: { type: 'boolean', description: 'Return the draft version (latest saved, may differ from live) plus has_unpublished_changes, instead of the published version. Default false.' },
      },
      required: ['collection', 'slug'],
    },
    handler: (db, args, collection) => {
      if (args.draft) {
        const entry = getEntry(db, collection.id, args.slug);
        if (!entry) throw new ToolError('Entry not found.');
        // Same flat shape as the published read, so draft: true is a drop-in;
        // status and has_unpublished_changes are the only extra keys.
        const out: Record<string, any> = { ...entry.data, slug: entry.slug, status: entryState(entry.status, entry.published_at), updated_at: isoUtc(entry.updated_at) };
        if (entry.published_at) out.published_at = isoUtc(entry.published_at);
        if (hasUnpublishedChanges(entry)) out.has_unpublished_changes = true;
        return out;
      }
      const item = getPublished(db, collection.id, args.slug);
      if (!item) throw new ToolError('Entry not found or not published.');
      return item;
    },
  },
  {
    name: 'create_entry',
    description: 'Create an entry, or overwrite it if slug already exists in this collection (idempotent upsert, safe to re-run). data is an object keyed by field name, taken as the complete field set on upsert (not merged). Set publish: true to publish immediately. Pass slug to make the entry addressable at that slug instead of a generated UUID (slugified on first create; an existing draft or published entry at that slug is matched and overwritten, not duplicated).',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('Collection slug'),
        data: { type: 'object', description: 'Field values keyed by field name (full replacement on upsert)' },
        slug: str('Entry slug (optional; defaults to a generated UUID). Matches an existing entry at this slug for upsert.'),
        publish: { type: 'boolean', description: 'Publish immediately (default false)' },
      },
      required: ['collection', 'data'],
    },
    handler: (db, args, collection, ctx) => {
      const data = normalizeJsonFields(collection, args.data);
      const existing = args.slug ? getEntry(db, collection.id, slugify(args.slug)) : null;
      const errors = validateEntryData(collection, data, { db, excludeEntryId: existing?.id ?? 0 });
      if (errors.length) throw new ToolError(errors.join(' '));
      let entry = existing ? updateEntry(db, existing, { data }) : createEntry(db, collection, { data, slug: args.slug });
      if (args.publish) {
        entry = publishEntry(db, entry.id);
        ctx?.onWebhook?.('entry.publish', collection.slug, entry.slug);
      }
      const out: Record<string, any> = { slug: entry.slug, status: entry.status, data: entry.data, upserted: !!existing };
      if (hasUnpublishedChanges(entry)) out.has_unpublished_changes = true;
      return out;
    },
  },
  {
    name: 'batch_create_entries',
    description: 'Create or upsert many entries in one call (one transaction, per-item results). entries is an array of {slug?, data, publish?}; same upsert semantics as create_entry. Top-level publish applies to every item without its own flag. Max 200 per call and 8 MB request body (413 with limit_bytes beyond that); chunk big imports by payload size.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('Collection slug'),
        entries: {
          type: 'array',
          description: 'Entries to create/upsert, each {slug?, data, publish?}',
          items: {
            type: 'object',
            properties: {
              slug: str('Entry slug (optional; upserts when it exists)'),
              data: { type: 'object', description: 'Field values keyed by field name' },
              publish: { type: 'boolean', description: 'Publish this entry (overrides the top-level flag)' },
            },
            required: ['data'],
          },
        },
        publish: { type: 'boolean', description: 'Publish every entry immediately (default false)' },
        preserve_timestamps: { type: 'boolean', description: 'Keep existing updated_at (and published_at on republish) instead of bumping them. Useful for cosmetic bulk edits that should not move sitemap lastmod. First-time publish still stamps published_at normally. Default false.' },
      },
      required: ['collection', 'entries'],
    },
    handler: (db, args, collection, ctx) => {
      if (!Array.isArray(args.entries) || args.entries.length === 0) throw new ToolError('entries must be a non-empty array.');
      if (args.entries.length > 200) throw new ToolError('Max 200 entries per call; split into batches.');
      const pt = !!args.preserve_timestamps;
      const results: any[] = [];
      db.exec('BEGIN');
      try {
        for (const item of args.entries) {
          try {
            const data = normalizeJsonFields(collection, item?.data ?? {});
            const existing = item.slug ? getEntry(db, collection.id, slugify(item.slug)) : null;
            const errors = validateEntryData(collection, data, { db, excludeEntryId: existing?.id ?? 0 });
            if (errors.length) {
              results.push({ slug: item?.slug ?? null, ok: false, error: errors.join(' ') });
              continue;
            }
            let entry = existing ? updateEntry(db, existing, { data, preserveTimestamps: pt }) : createEntry(db, collection, { data, slug: item.slug });
            if (item.publish ?? args.publish) {
              entry = publishEntry(db, entry.id, { preserveTimestamps: pt });
              ctx?.onWebhook?.('entry.publish', collection.slug, entry.slug);
            }
            results.push({ slug: entry.slug, ok: true, status: entry.status, upserted: !!existing });
          } catch (err) {
            results.push({ slug: item?.slug ?? null, ok: false, error: err instanceof Error ? err.message : String(err) });
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      const ok = results.filter((r) => r.ok);
      return {
        created: ok.filter((r) => !r.upserted).length,
        updated: ok.filter((r) => r.upserted).length,
        failed: results.length - ok.length,
        results,
      };
    },
  },
  {
    name: 'update_entry',
    description: 'Update fields on an entry (merged into existing data, recorded as a revertable revision). Editing a published entry changes only its draft: the return carries has_unpublished_changes: true until you republish. Set publish: true to republish in the same call; otherwise republish with publish_entry to update the live version.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('Collection slug'),
        slug: str('Entry slug'),
        data: { type: 'object', description: 'Field values to set, merged into existing data' },
        publish: { type: 'boolean', description: 'Publish immediately after the update (default false)' },
        preserve_timestamps: { type: 'boolean', description: 'Keep existing updated_at (and published_at on republish) instead of bumping them. Useful for cosmetic edits that should not move sitemap lastmod. First-time publish still stamps published_at normally. Default false.' },
      },
      required: ['collection', 'slug', 'data'],
    },
    handler: (db, args, collection, ctx) => {
      const entry = getEntry(db, collection.id, args.slug);
      if (!entry) throw new ToolError('Entry not found.');
      const merged = { ...entry.data, ...normalizeJsonFields(collection, args.data) };
      const errors = validateEntryData(collection, merged, { db, excludeEntryId: entry.id });
      if (errors.length) throw new ToolError(errors.join(' '));
      const pt = !!args.preserve_timestamps;
      let updated = updateEntry(db, entry, { data: merged, preserveTimestamps: pt });
      if (args.publish) {
        updated = publishEntry(db, updated.id, { preserveTimestamps: pt });
        ctx?.onWebhook?.('entry.publish', collection.slug, updated.slug);
      }
      const out: Record<string, any> = { slug: updated.slug, status: updated.status, data: updated.data };
      if (hasUnpublishedChanges(updated)) out.has_unpublished_changes = true;
      return out;
    },
  },
  {
    name: 'publish_entry',
    description: 'Publish an entry (or republish after edits). Pass at (ISO 8601, UTC) to schedule: the entry stays hidden from the API until that time.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { collection: str('Collection slug'), slug: str('Entry slug'), at: str('Optional go-live time, ISO 8601 UTC (e.g. 2026-10-01T09:00:00Z). Omit to publish now.') },
      required: ['collection', 'slug'],
    },
    handler: (db, args, collection, ctx) => {
      const entry = getEntry(db, collection.id, args.slug);
      if (!entry) throw new ToolError('Entry not found.');
      if (args.at && Number.isNaN(new Date(args.at).getTime())) throw new ToolError('Invalid at: use ISO 8601 UTC.');
      const published = publishEntry(db, entry.id, { at: args.at || '' });
      ctx?.onWebhook?.('entry.publish', collection.slug, published.slug);
      return { slug: published.slug, status: entryState(published.status, published.published_at), ...(args.at ? { publish_at: isoUtc(published.published_at) } : {}) };
    },
  },
  {
    name: 'unpublish_entry',
    description: 'Unpublish an entry (back to draft, removed from the API).',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { collection: str('Collection slug'), slug: str('Entry slug') },
      required: ['collection', 'slug'],
    },
    handler: (db, args, collection, ctx) => {
      const entry = getEntry(db, collection.id, args.slug);
      if (!entry) throw new ToolError('Entry not found.');
      unpublishEntry(db, entry.id);
      ctx?.onWebhook?.('entry.unpublish', collection.slug, entry.slug);
      return { slug: entry.slug, status: 'draft' };
    },
  },
  {
    name: 'delete_entry',
    description: 'Delete an entry permanently (its revisions go with it). Unpublish first is not required.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { collection: str('Collection slug'), slug: str('Entry slug') },
      required: ['collection', 'slug'],
    },
    handler: (db, args, collection, ctx) => {
      const entry = getEntry(db, collection.id, args.slug);
      if (!entry) throw new ToolError('Entry not found.');
      const wasPublished = entry.status === 'published';
      deleteEntry(db, entry.id);
      if (wasPublished) {
        ctx?.onWebhook?.('entry.delete', collection.slug, entry.slug);
      }
      return { slug: entry.slug, deleted: true };
    },
  },
  {
    name: 'upload_media',
    description: 'Upload a file to the project media storage (file bytes as base64). Returns {id, key, url}; url is the full public URL, ready to embed in content. Re-uploading identical content returns the existing row. Optional path stores the object under a folder prefix (e.g. "uploads/2026/09"; safe path segments only), allowed only when the target storage has a public base URL. Request body cap is 8 MB, so files up to roughly 6 MB fit after base64 overhead.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        filename: str('Original filename; its extension picks the MIME type and the stored key ends with a slug of it'),
        data_base64: str('File content, base64-encoded'),
        path: str('Optional folder prefix for the stored key, like "uploads/2026/09"'),
        storage: str('Optional storage name (defaults to the project default storage)'),
        variants: { type: 'boolean', description: 'Also generate resized image variants (default false)' },
      },
      required: ['filename', 'data_base64'],
    },
    handler: async (db, args, _collection, ctx) => {
      if (!ctx?.uploadMedia) throw new ToolError('Media upload is not available on this server.');
      if (typeof args.filename !== 'string' || !args.filename.trim()) throw new ToolError('filename is required.');
      if (typeof args.data_base64 !== 'string' || !args.data_base64) throw new ToolError('data_base64 is required.');
      let data;
      try {
        data = Buffer.from(args.data_base64, 'base64');
      } catch {
        throw new ToolError('data_base64 is not valid base64.');
      }
      if (data.length === 0) throw new ToolError('data_base64 decoded to an empty file.');
      return ctx.uploadMedia({
        filename: args.filename.trim(),
        data,
        path: args.path || '',
        storage: args.storage || '',
        variants: !!args.variants,
      });
    },
  },

  // ---- Schema management ---------------------------------------------------

  {
    name: 'get_schema',
    description: 'Full project schema: every collection with name, slug and complete field list (each field carries its type and all stored options). Same document shape apply_schema accepts.',
    scope: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: (db) => exportSchema(db),
  },
  {
    name: 'describe_field_types',
    description: 'Introspect the field type system: every field type with its value shape and the options it accepts (with meanings), plus the reserved field names the builder never mints. Derived from the server type registry, so it is always current.',
    scope: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: () => describeFieldTypes(),
  },
  {
    name: 'create_collection',
    description: 'Create an empty collection. The slug is derived from the name (suffixed when taken); add fields with add_field.',
    scope: 'write',
    inputSchema: { type: 'object', properties: { name: str('Collection display name') }, required: ['name'] },
    handler: (db, args) => {
      if (typeof args.name !== 'string' || !args.name.trim()) throw new ToolError('name is required.');
      const c = createCollection(db, args.name.trim());
      return { name: c.name, slug: c.slug, fields: c.fields };
    },
  },
  {
    name: 'add_field',
    description: 'Add a field to a collection. name is the data key (derived from label when omitted; reserved and duplicate names get suffixed, so read the returned field for the final name). options takes any option valid for the type (see describe_field_types). Returns the created field.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('Collection slug'),
        label: str('Human label shown in the editor'),
        type: str(`Field type: ${FIELD_TYPES.join(', ')}`),
        name: str('Explicit data key (optional; slugified, immutable after creation)'),
        required: bool('Reject empty values on save'),
        unique: bool('Value must be unique in the collection'),
        options: { type: 'object', description: 'Extra options keyed by option name, e.g. {"maxlength": 80} (see describe_field_types)' },
        force: bool('Apply even if it would break existing entry data (default false)'),
      },
      required: ['collection', 'label', 'type'],
    },
    handler: (db, args, collection) => {
      if (!FIELD_TYPES.includes(args.type)) throw new ToolError(`Unknown field type: ${args.type}. See describe_field_types.`);
      if (typeof args.label !== 'string' || !args.label.trim()) throw new ToolError('label is required.');
      const opts = checkFieldOptions(args.type, args.options);
      try {
        let updated = addCollectionField(db, collection.slug, {
          label: args.label.trim(),
          type: args.type,
          name: args.name ?? '',
          required: !!args.required,
          unique: !!args.unique,
          force: !!args.force,
        });
        const field = updated.fields[updated.fields.length - 1];
        if (Object.keys(opts).length) {
          updated = updateCollectionField(db, collection.slug, field.name, { ...field, ...opts, force: !!args.force });
        }
        return updated.fields.find((f) => f.name === field.name);
      } catch (err) {
        rethrowImpact(err);
      }
    },
  },
  {
    name: 'update_field',
    description: 'Update a field: label, type, required/unique and options. The field name (data key) is immutable. Unmentioned options keep their current value; set an option to null (or required/unique to false) to clear it. Changing the type drops options the new type does not accept. Returns the updated field.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('Collection slug'),
        field: str('Field name (data key)'),
        label: str('New label (optional)'),
        type: str(`New field type (optional): ${FIELD_TYPES.join(', ')}`),
        required: bool('Set or clear required'),
        unique: bool('Set or clear unique'),
        options: { type: 'object', description: 'Options to set, merged into the current ones; null clears an option' },
        force: bool('Apply even if it would break existing entry data (default false)'),
      },
      required: ['collection', 'field'],
    },
    handler: (db, args, collection) => {
      const existing = collection.fields.find((f) => f.name === args.field);
      if (!existing) throw new ToolError(`Field not found: ${args.field}`);
      const type = args.type ?? existing.type;
      if (!FIELD_TYPES.includes(type)) throw new ToolError(`Unknown field type: ${args.type}. See describe_field_types.`);
      const opts = checkFieldOptions(type, args.options);
      const allowed = validOptionsFor(type);
      const carried = Object.fromEntries(
        Object.entries(existing).filter(([k]) => FIELD_OPTIONS.includes(k) && allowed.has(k)),
      );
      const props = {
        label: args.label ?? existing.label,
        type,
        ...carried,
        ...(args.required === undefined ? {} : { required: args.required }),
        ...(args.unique === undefined ? {} : { unique: args.unique }),
        ...opts,
        force: !!args.force,
      };
      try {
        const updated = updateCollectionField(db, collection.slug, args.field, props);
        return updated.fields.find((f) => f.name === args.field);
      } catch (err) {
        rethrowImpact(err);
      }
    },
  },
  {
    name: 'remove_field',
    description: 'Remove a field from a collection schema; it is archived, not deleted (restore it with restore_field). Stored entry values for the field stay in the entry data (restoring or re-adding a field with the same name brings them back) and already-published output keeps them until each entry is republished.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { collection: str('Collection slug'), field: str('Field name (data key)') },
      required: ['collection', 'field'],
    },
    handler: (db, args, collection) => {
      if (!collection.fields.some((f) => f.name === args.field)) throw new ToolError(`Field not found: ${args.field}`);
      removeCollectionField(db, collection.slug, args.field);
      return { removed: args.field, fields: collection.fields.filter((f) => f.name !== args.field) };
    },
  },
  {
    name: 'restore_field',
    description: 'Restore a field previously removed with remove_field, with its original type and options. Fails if a field with the same name already exists. Entries created while the field was archived may not satisfy its old constraints (e.g. required); blocked the same way as add_field/update_field unless force: true.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('Collection slug'),
        field: str('Field name (data key)'),
        force: bool('Apply even if it would break existing entry data (default false)'),
      },
      required: ['collection', 'field'],
    },
    handler: (db, args, collection) => {
      if (!collection.archived_fields.some((f) => f.name === args.field)) throw new ToolError(`No archived field named: ${args.field}`);
      try {
        const updated = restoreCollectionField(db, collection.slug, args.field, !!args.force);
        return updated.fields.find((f) => f.name === args.field);
      } catch (err) {
        if (err instanceof SchemaImpactError) rethrowImpact(err);
        if (err instanceof ToolError) throw err;
        throw new ToolError(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    name: 'check_schema_health',
    description: 'Scan every field in every collection against live entry data and report ones that would now fail validation (drift from a forced schema change, or data edited outside validation). Read-only.',
    scope: 'read',
    inputSchema: { type: 'object', properties: {} },
    handler: (db) => checkSchemaHealth(db),
  },
  {
    name: 'apply_schema',
    description: 'Apply a full schema document (the shape get_schema returns): collections are matched by slug and created or updated to match; each field list is replaced wholesale. Idempotent. Project collections missing from the document are reported under "missing"; they are only deleted (with all their entries, destructive) when delete_missing is true.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'object', description: 'Schema document: {collections: [{slug, name, fields: [{name, label, type, ...options}]}]}' },
        delete_missing: bool('Delete collections (and their entries) not present in the document (default false)'),
      },
      required: ['schema'],
    },
    handler: (db, args) => {
      try {
        return applySchema(db, args.schema, { deleteMissing: !!args.delete_missing });
      } catch (err) {
        throw new ToolError(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    name: 'bulk_rewrite_refs',
    description: 'Cosmetically swap exact full URLs across all entries (e.g. .png -> .webp of the same asset). Each pair replaces old with new in both the published content and the draft, WITHOUT touching updated_at or published_at, so sitemap lastmod stays frozen; one content_version bump forces a single rebuild. old and new must be full https:// URLs (never a bare extension) and differ. Set dry_run: true to get match counts and change nothing. Live runs are logged for audit. Intended for cosmetic ref migrations, not content edits.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        pairs: {
          type: 'array',
          description: 'URL swaps, each {old, new} as full https:// URLs',
          items: {
            type: 'object',
            properties: { old: str('Exact full URL to find'), new: str('Full URL to replace it with') },
            required: ['old', 'new'],
          },
        },
        dry_run: { type: 'boolean', description: 'Report match counts without changing anything (default false)' },
      },
      required: ['pairs'],
    },
    handler: (db, args) => {
      try {
        return bulkRewriteRefs(db, args.pairs, { dryRun: !!args.dry_run });
      } catch (err) {
        throw new ToolError(err instanceof Error ? err.message : String(err));
      }
    },
  },
];

export class ToolError extends Error {}
// Unknown tool name and wrong-scope refusals: each transport maps these to its
// own error shape (JSON-RPC error vs HTTP status), distinct from ToolError,
// which is a normal tool-level failure the caller should read and react to.
export class UnknownToolError extends Error {}
export class ToolScopeError extends Error {}

// The ONE place a tool name is resolved and run. Both transports, the MCP
// JSON-RPC endpoint (handleMcp) and the REST POST /api/v1/<project>/call/<tool>
// route, go through this over the same TOOLS registry, so every tool is
// reachable on both and their feature sets cannot drift apart. Throws
// UnknownToolError / ToolScopeError / ToolError; callers map those to their
// transport's error shape.
export async function callTool(db, name: string, args: any, scope: string, ctx: any = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new UnknownToolError(`Unknown tool: ${name}`);
  if (tool.scope === 'write' && scope !== 'write') {
    throw new ToolScopeError('This API key is read-only; a write-scope key is required.');
  }
  let collection = null;
  if (tool.inputSchema.properties.collection) {
    const slug = args?.collection;
    // Guard the lookup: a missing or non-string slug must be a clean tool
    // failure, not a SQLite bind crash (a client can omit the argument).
    collection = typeof slug === 'string' && slug ? getCollection(db, slug) : null;
    if (!collection) throw new ToolError(`Collection not found: ${slug ?? '(missing)'}`);
  }
  return tool.handler(db, args ?? {}, collection, ctx);
}

// Tool registry catalog (no handlers) for transports that enumerate tools:
// REST discovery and the parity smoke test that proves no tool is REST-only or
// MCP-only.
export const toolCatalog = TOOLS.map(({ name, scope, description, inputSchema }) => ({ name, scope, description, inputSchema }));

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

// Handles one JSON-RPC message. Returns the response object, or null for
// notifications (respond 202 with no body).
export async function handleMcp(db, projectName: string, message: any, scope: string, ctx: any = {}) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message?.id, -32600, 'Invalid request.');
  }
  const { id, method, params = {} } = message;
  if (id === undefined) return null; // notification (e.g. notifications/initialized)

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: `Boring CMS (${projectName})`, version: APP_VERSION },
      });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: TOOLS.filter((t) => t.scope === 'read' || scope === 'write').map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      try {
        const result = await callTool(db, params.name, params.arguments ?? {}, scope, ctx);
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        // Unknown tool and scope refusal are protocol errors; a tool-level
        // failure (bad args, missing collection) is isError content the agent
        // can read and react to.
        if (err instanceof UnknownToolError || err instanceof ToolScopeError) return rpcError(id, -32602, err.message);
        if (err instanceof ToolError) return toolFailure(id, err.message);
        throw err;
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// Tool-level failures go back as isError content, not protocol errors, so
// the agent can read and react to them.
function toolFailure(id, message: string) {
  return rpcResult(id, { content: [{ type: 'text', text: message }], isError: true });
}
