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
  validateEntryData,
  listPublished,
  getPublished,
  slugify,
} from './content.ts';
import { APP_VERSION } from './views.ts';

const PROTOCOL_VERSION = '2025-03-26';

// ---- Rate limit: per-key token bucket, in memory ---------------------------
// ponytail: in-memory only, resets on restart; move to SQLite if multi-process ever happens.

export const DEFAULT_RATE_LIMIT = 60; // requests per minute per key, project can override via meta
export const MCP_BODY_LIMIT = 8 * 1024 * 1024; // bytes; 200 typical CMS entries easily pass 1MB
const buckets = new Map<string, { tokens: number; ts: number }>();

export function rateLimitOk(bucketKey: string, limit = DEFAULT_RATE_LIMIT): boolean {
  const now = Date.now();
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
    name: 'get_entry',
    description: 'Get one published entry by slug.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: { collection: str('Collection slug'), slug: str('Entry slug') },
      required: ['collection', 'slug'],
    },
    handler: (db, args, collection) => {
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
      return { slug: entry.slug, status: entry.status, data: entry.data, upserted: !!existing };
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
      },
      required: ['collection', 'entries'],
    },
    handler: (db, args, collection, ctx) => {
      if (!Array.isArray(args.entries) || args.entries.length === 0) throw new ToolError('entries must be a non-empty array.');
      if (args.entries.length > 200) throw new ToolError('Max 200 entries per call; split into batches.');
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
            let entry = existing ? updateEntry(db, existing, { data }) : createEntry(db, collection, { data, slug: item.slug });
            if (item.publish ?? args.publish) {
              entry = publishEntry(db, entry.id);
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
    description: 'Update fields on an entry (merged into existing data, recorded as a revertable revision). Set publish: true to republish in the same call; otherwise republish with publish_entry to update the live version.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('Collection slug'),
        slug: str('Entry slug'),
        data: { type: 'object', description: 'Field values to set, merged into existing data' },
        publish: { type: 'boolean', description: 'Publish immediately after the update (default false)' },
      },
      required: ['collection', 'slug', 'data'],
    },
    handler: (db, args, collection, ctx) => {
      const entry = getEntry(db, collection.id, args.slug);
      if (!entry) throw new ToolError('Entry not found.');
      const merged = { ...entry.data, ...normalizeJsonFields(collection, args.data) };
      const errors = validateEntryData(collection, merged, { db, excludeEntryId: entry.id });
      if (errors.length) throw new ToolError(errors.join(' '));
      let updated = updateEntry(db, entry, { data: merged });
      if (args.publish) {
        updated = publishEntry(db, updated.id);
        ctx?.onWebhook?.('entry.publish', collection.slug, updated.slug);
      }
      return { slug: updated.slug, status: updated.status, data: updated.data };
    },
  },
  {
    name: 'publish_entry',
    description: 'Publish an entry (or republish after edits).',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: { collection: str('Collection slug'), slug: str('Entry slug') },
      required: ['collection', 'slug'],
    },
    handler: (db, args, collection, ctx) => {
      const entry = getEntry(db, collection.id, args.slug);
      if (!entry) throw new ToolError('Entry not found.');
      const published = publishEntry(db, entry.id);
      ctx?.onWebhook?.('entry.publish', collection.slug, published.slug);
      return { slug: published.slug, status: published.status };
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
];

export class ToolError extends Error {}

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
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
      if (tool.scope === 'write' && scope !== 'write') {
        return rpcError(id, -32602, 'This API key is read-only; a write-scope key is required.');
      }
      const args = params.arguments ?? {};
      let collection = null;
      if (tool.inputSchema.properties.collection) {
        collection = getCollection(db, args.collection);
        if (!collection) return toolFailure(id, `Collection not found: ${args.collection}`);
      }
      try {
        const result = await tool.handler(db, args, collection, ctx);
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
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
