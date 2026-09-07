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
  validateEntryData,
  listPublished,
  getPublished,
  slugify,
} from './content.ts';

const PROTOCOL_VERSION = '2025-03-26';

// ---- Rate limit: per-key token bucket, in memory ---------------------------
// ponytail: in-memory only, resets on restart; move to SQLite if multi-process ever happens.

const RATE_LIMIT = 60; // requests per minute per key
const buckets = new Map<string, { tokens: number; ts: number }>();

export function rateLimitOk(bucketKey: string): boolean {
  const now = Date.now();
  const b = buckets.get(bucketKey) ?? { tokens: RATE_LIMIT, ts: now };
  b.tokens = Math.min(RATE_LIMIT, b.tokens + ((now - b.ts) / 60000) * RATE_LIMIT);
  b.ts = now;
  if (b.tokens < 1) {
    buckets.set(bucketKey, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(bucketKey, b);
  return true;
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
    description: 'List published entries in a collection (same shape as the REST API).',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('Collection slug'),
        limit: { type: 'number', description: 'Max entries (default 50, cap 100)' },
        offset: { type: 'number', description: 'Pagination offset' },
      },
      required: ['collection'],
    },
    handler: (db, args, collection) => listPublished(db, collection.id, { limit: args.limit ?? 50, offset: args.offset ?? 0 }),
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
    handler: (db, args, collection) => {
      const errors = validateEntryData(collection, args.data);
      if (errors.length) throw new ToolError(errors.join(' '));
      const existing = args.slug ? getEntry(db, collection.id, slugify(args.slug)) : null;
      let entry = existing ? updateEntry(db, existing, { data: args.data }) : createEntry(db, collection, { data: args.data, slug: args.slug });
      if (args.publish) entry = publishEntry(db, entry.id);
      return { slug: entry.slug, status: entry.status, data: entry.data, upserted: !!existing };
    },
  },
  {
    name: 'update_entry',
    description: 'Update fields on an entry (merged into existing data, recorded as a revertable revision). Republish with publish_entry to update the live version.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        collection: str('Collection slug'),
        slug: str('Entry slug'),
        data: { type: 'object', description: 'Field values to set, merged into existing data' },
      },
      required: ['collection', 'slug', 'data'],
    },
    handler: (db, args, collection) => {
      const entry = getEntry(db, collection.id, args.slug);
      if (!entry) throw new ToolError('Entry not found.');
      const merged = { ...entry.data, ...args.data };
      const errors = validateEntryData(collection, merged);
      if (errors.length) throw new ToolError(errors.join(' '));
      const updated = updateEntry(db, entry, { data: merged });
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
    handler: (db, args, collection) => {
      const entry = getEntry(db, collection.id, args.slug);
      if (!entry) throw new ToolError('Entry not found.');
      const published = publishEntry(db, entry.id);
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
    handler: (db, args, collection) => {
      const entry = getEntry(db, collection.id, args.slug);
      if (!entry) throw new ToolError('Entry not found.');
      unpublishEntry(db, entry.id);
      return { slug: entry.slug, status: 'draft' };
    },
  },
];

class ToolError extends Error {}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

// Handles one JSON-RPC message. Returns the response object, or null for
// notifications (respond 202 with no body).
export function handleMcp(db, projectName: string, message: any, scope: string) {
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
        serverInfo: { name: `yncms (${projectName})`, version: '1.0.0' },
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
        const result = tool.handler(db, args, collection);
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
