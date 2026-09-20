// OpenAPI 3.1 document for one project's public surface: content API, counter
// endpoints, schema/export/import, media upload, the generic /call/<tool>
// transport (one path per tool, generated from the same TOOLS registry MCP
// serves, so the spec cannot drift from the code) and the /mcp endpoint.
//
// Built on first request and memoized per (project, origin, rate limit) in
// server.ts; nothing here runs at startup. The document imports directly into
// Postman, Insomnia, Hoppscotch or Swagger UI, which doubles as a playground.

import { toolCatalog } from './mcp.ts';

const BEARER = [{ bearerKey: [] }];

function jsonResponse(description: string, schema: any = { type: 'object' }, headers?: Record<string, any>) {
  return { description, ...(headers ? { headers } : {}), content: { 'application/json': { schema } } };
}

const ERR = (description: string) => jsonResponse(description, { $ref: '#/components/schemas/Error' });

const ETAG_HEADER = { ETag: { description: 'Opaque content tag. Send back as If-None-Match for a free 304.', schema: { type: 'string' } } };
const RATE_HEADERS = {
  'RateLimit-Limit': { description: 'Requests allowed per minute for this key.', schema: { type: 'integer' } },
  'RateLimit-Remaining': { description: 'Requests left in the current window.', schema: { type: 'integer' } },
  'RateLimit-Reset': { description: 'Seconds until the bucket is full again.', schema: { type: 'integer' } },
};

export function buildOpenApi({ origin, project, rateLimit = 0, counterLimit = 0 }: { origin: string; project: string; rateLimit?: number; counterLimit?: number }) {
  // 0 = limit disabled (the per-project setting on the API keys page).
  const perKey = rateLimit;
  const p = (rest: string) => `/api/v1/${project}${rest}`;

  const keyLimit = { scope: 'api-key', limit: perKey || 'unlimited', per: 'minute', applies_to: 'every write endpoint and every /call and /mcp tool call (reads are not rate limited)', configurable: 'Admin > API keys > Rate limit' };
  const ipLimit = { scope: 'client-ip', limit: counterLimit || 'unlimited', per: 'minute', applies_to: 'public counter votes only (POST .../counters/<field> on a public-access field)', note: 'Behind a proxy the server must run with TRUST_PROXY=1 so the visitor IP is read from X-Forwarded-For; otherwise every visitor shares the proxy IP and this limit throttles them together.' };

  const paths: Record<string, any> = {
    [p('/{collection}')]: {
      get: {
        tags: ['content'], summary: 'List published entries', security: BEARER,
        description: 'Published entries only, newest first. Entries scheduled for a future go-live are hidden until their time. The response body is cached server-side and the ETag flips on any change (including a scheduled entry going live), so it never serves stale data. Bodies are gzipped when the client sends Accept-Encoding: gzip.',
        parameters: [
          { name: 'collection', in: 'path', required: true, schema: { type: 'string' }, description: 'Collection slug.' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'updated_since', in: 'query', schema: { type: 'string' }, description: 'ISO 8601 UTC. Entries changed after this time, including scheduled entries whose go-live passed it.' },
          { name: 'If-None-Match', in: 'header', schema: { type: 'string' }, description: 'ETag from a previous response; a match returns an empty 304.' },
        ],
        responses: {
          200: jsonResponse('Entry list.', { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Entry' } } } }, ETAG_HEADER),
          304: { description: 'Not modified (If-None-Match matched).', headers: ETAG_HEADER },
          401: ERR('Missing or invalid API key.'), 404: ERR('Unknown project or collection.'),
        },
      },
    },
    [p('/{collection}/{entry}')]: {
      get: {
        tags: ['content'], summary: 'One published entry', security: BEARER,
        description: 'The published snapshot of one entry. Counter field totals are NOT included; read them from the counters endpoints so votes never invalidate this response’s ETag.',
        parameters: [
          { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'entry', in: 'path', required: true, schema: { type: 'string' }, description: 'Entry slug.' },
          { name: 'If-None-Match', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          200: jsonResponse('Entry.', { $ref: '#/components/schemas/Entry' }, ETAG_HEADER),
          304: { description: 'Not modified.', headers: ETAG_HEADER },
          401: ERR('Missing or invalid API key.'), 404: ERR('Not found (also returned while an entry is scheduled and not yet live).'),
        },
      },
    },
    [p('/{collection}/{entry}/counters/{field}')]: {
      post: {
        tags: ['counters'], summary: 'Vote on a counter field', 'x-auth-note': 'Public for public-access fields (no key). Private (key-access) fields need a write-scope key.',
        description: 'Public-access fields (the default) need no key: one up/down vote per visitor per 24h (repeat same-direction votes are no-ops, the opposite direction switches the vote), deduped in memory by a salted hash of IP + user agent, per-IP rate limited, CORS open so a static site can call it from the browser. Private ("key") fields require a write-scope key and take an arbitrary step via ?by= (no dedupe). Totals are eventually consistent within about 5 seconds (write-behind flush). Votes never change entry ETags, revisions, updated_at or webhooks.',
        'x-rate-limit': ipLimit,
        parameters: [
          { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'entry', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'field', in: 'path', required: true, schema: { type: 'string' }, description: 'Counter field name.' },
          { name: 'dir', in: 'query', schema: { type: 'string', enum: ['up', 'down'], default: 'up' } },
          { name: 'by', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000, default: 1 }, description: 'Step size. Private (key-access) fields only; ignored on public fields.' },
        ],
        responses: {
          200: jsonResponse('Totals after the vote. changed:false means the visitor already voted this way.', { $ref: '#/components/schemas/CounterTotals' }),
          400: ERR('Bad dir.'), 401: ERR('Private field, no key.'), 403: ERR('Private field, key is not write scope.'),
          404: ERR('Unknown project, collection, entry or counter field.'),
          429: jsonResponse('Per-IP rate limit hit (public fields).', { $ref: '#/components/schemas/Error' }, { 'Retry-After': { description: 'Seconds to wait.', schema: { type: 'integer' } } }),
        },
      },
    },
    [p('/{collection}/{entry}/counters')]: {
      get: {
        tags: ['counters'], summary: 'Counter totals for one entry', 'x-auth-note': 'Public for public-access fields. Send a key to also see private fields.',
        description: 'No key needed for public fields; private (key-access) fields appear only when a valid key is sent. Responses are Cache-Control: no-cache and carry no ETag: totals move too often to cache.',
        parameters: [
          { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'entry', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: jsonResponse('Field name to totals map.', { type: 'object', additionalProperties: { $ref: '#/components/schemas/CounterTotals' } }), 404: ERR('Not found.') },
      },
    },
    [p('/{collection}/counters')]: {
      get: {
        tags: ['counters'], summary: 'Counter totals for many entries', 'x-auth-note': 'Public for public-access fields. Send a key to also see private fields.',
        parameters: [
          { name: 'collection', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'slugs', in: 'query', required: true, schema: { type: 'string' }, description: 'Comma-separated entry slugs, max 100.' },
        ],
        responses: { 200: jsonResponse('items: slug to (field to totals) map.', { type: 'object', properties: { items: { type: 'object' } } }), 400: ERR('slugs missing.'), 404: ERR('Not found.') },
      },
    },
    [p('/schema')]: {
      get: {
        tags: ['schema'], summary: 'Full project schema', security: BEARER,
        responses: { 200: jsonResponse('Every collection with its field list and options.'), 401: ERR('Unauthorized.') },
      },
      post: {
        tags: ['schema'], summary: 'Apply a schema document', security: BEARER, 'x-scope': 'write', 'x-rate-limit': keyLimit,
        description: 'Write scope. Collections matched by slug, created or updated, field lists replaced wholesale. ?delete_missing=1 also deletes collections absent from the document (destructive: their entries go too).',
        parameters: [{ name: 'delete_missing', in: 'query', schema: { type: 'string', enum: ['1'] } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { collections: { type: 'array', items: { type: 'object' } } }, required: ['collections'] } } } },
        responses: { 200: jsonResponse('Apply report.', { type: 'object' }, RATE_HEADERS), 400: ERR('Invalid document.'), 401: ERR('Unauthorized.'), 403: ERR('Read-scope key.'), 429: ERR('Rate limited.') },
      },
    },
    [p('/field-types')]: {
      get: { tags: ['schema'], summary: 'Field type introspection', security: BEARER, responses: { 200: jsonResponse('Value shape and accepted options per field type.'), 401: ERR('Unauthorized.') } },
    },
    [p('/export')]: {
      get: { tags: ['transfer'], summary: 'Export the whole project', security: BEARER, description: 'Schema plus every entry (drafts included, scheduled go-lives preserved). Round-trips into POST /import.', responses: { 200: jsonResponse('Project dump.'), 401: ERR('Unauthorized.') } },
    },
    [p('/import')]: {
      post: {
        tags: ['transfer'], summary: 'Restore a project from an export dump', security: BEARER, 'x-scope': 'write', 'x-rate-limit': keyLimit,
        description: 'Write scope. Non-destructive upsert by slug; ?delete_missing=1 forwards to the schema apply. Body limit 64 MB.',
        parameters: [{ name: 'delete_missing', in: 'query', schema: { type: 'string', enum: ['1'] } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: jsonResponse('Restore report.', { type: 'object' }, RATE_HEADERS), 400: ERR('Invalid dump or over 64 MB.'), 401: ERR('Unauthorized.'), 403: ERR('Read-scope key.'), 429: ERR('Rate limited.') },
      },
    },
    [p('/rewrite-refs')]: {
      post: {
        tags: ['transfer'], summary: 'Bulk cosmetic URL swap across all entries', security: BEARER, 'x-scope': 'write', 'x-rate-limit': keyLimit,
        description: 'Write scope. Replaces exact URLs in every entry without moving updated_at (sitemap lastmod stays frozen). Body: {pairs: [{old, new}], dry_run?}.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { pairs: { type: 'array', items: { type: 'object', properties: { old: { type: 'string' }, new: { type: 'string' } } } }, dry_run: { type: 'boolean' } }, required: ['pairs'] } } } },
        responses: { 200: jsonResponse('Rewrite report.', { type: 'object' }, RATE_HEADERS), 400: ERR('Invalid pairs.'), 401: ERR('Unauthorized.'), 403: ERR('Read-scope key.'), 429: ERR('Rate limited.') },
      },
    },
    [p('/media')]: {
      post: {
        tags: ['media'], summary: 'Upload a media file', security: BEARER, 'x-scope': 'write', 'x-rate-limit': keyLimit,
        description: 'Write scope, multipart/form-data. Fields: file (required), path (optional folder prefix), storage, variants=1 (also produce resized variants; needs the optional sharp dependency).',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, path: { type: 'string' }, storage: { type: 'string' }, variants: { type: 'string', enum: ['1'] } }, required: ['file'] } } } },
        responses: { 200: jsonResponse('Stored media record with its public URL.', { type: 'object' }, RATE_HEADERS), 400: ERR('Bad multipart body.'), 401: ERR('Unauthorized.'), 403: ERR('Read-scope key.'), 429: ERR('Rate limited.') },
      },
    },
    [p('/openapi.json')]: {
      get: { tags: ['meta'], summary: 'This document', security: BEARER, responses: { 200: jsonResponse('OpenAPI 3.1 description of this project’s API.'), 401: ERR('Unauthorized.') } },
    },
    [`/mcp/${project}`]: {
      post: {
        tags: ['mcp'], summary: 'MCP endpoint (JSON-RPC 2.0 over POST)', security: BEARER, 'x-auth-note': 'Key must have MCP access enabled. Write tools also need write scope.', 'x-rate-limit': keyLimit,
        description: 'Model Context Protocol transport for agents. The key must have MCP access enabled (per-key opt-in in the admin). Methods: initialize, tools/list, tools/call. The tool registry is identical to the /call/<tool> REST paths below, same names, same argument schemas, same scopes; read tools work with any key, write tools need write scope. Body limit 8 MB.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { jsonrpc: { const: '2.0' }, id: {}, method: { type: 'string', enum: ['initialize', 'tools/list', 'tools/call'] }, params: { type: 'object' } }, required: ['jsonrpc', 'method'] } } } },
        responses: { 200: jsonResponse('JSON-RPC response (errors are JSON-RPC errors, HTTP stays 200).', { type: 'object' }, RATE_HEADERS), 401: ERR('Unauthorized or key lacks MCP access.'), 429: ERR('Rate limited.') },
      },
    },
  };

  // One path per tool from the shared registry: REST transport for every MCP
  // tool, importable and try-able as-is.
  for (const tool of toolCatalog) {
    paths[p(`/call/${tool.name}`)] = {
      post: {
        tags: ['tools'], summary: tool.description.split('.')[0], operationId: `call_${tool.name}`,
        security: BEARER, 'x-rate-limit': keyLimit, 'x-scope': tool.scope,
        description: `${tool.description}${tool.scope === 'write' ? ' Requires a write-scope key.' : ' Works with any key.'} Also callable over MCP as the "${tool.name}" tool with the same arguments.`,
        requestBody: { required: true, content: { 'application/json': { schema: tool.inputSchema } } },
        responses: {
          200: jsonResponse('Tool result.', { type: 'object' }, RATE_HEADERS),
          400: ERR('Invalid arguments.'), 401: ERR('Unauthorized.'),
          ...(tool.scope === 'write' ? { 403: ERR('Read-scope key on a write tool.') } : {}),
          429: ERR('Rate limited.'),
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `Boring CMS API: ${project}`,
      version: '1',
      description: 'Read-only content API plus tool endpoints for one Boring CMS project. Import this file into Postman, Insomnia, Hoppscotch or Swagger UI to browse and try every endpoint.',
      'x-rate-limits': [keyLimit, ipLimit],
      'x-headers': {
        request: {
          Authorization: 'Bearer yn_<key> on everything except public counter votes/reads and served media.',
          'If-None-Match': 'ETag revalidation on content reads; a match costs the server almost nothing.',
          'Accept-Encoding': 'gzip is honored on JSON responses.',
          'X-Forwarded-For': 'Read as the client IP only when the server runs with TRUST_PROXY=1 (set it when behind a proxy).',
        },
        response: {
          ETag: 'On content reads. Changes when anything published changes, including scheduled go-lives.',
          'RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset': 'On every rate-limited endpoint (writes, /call, /mcp, public votes).',
          'Retry-After': 'On 429 responses.',
          'Cache-Control': 'no-cache on counter reads; media files are immutable for one year.',
          'Server-Timing': 'total;dur=<ms> on every response.',
          'Access-Control-Allow-Origin': '* on the counter endpoints only, so browsers on any site can vote and read totals.',
        },
      },
    },
    servers: [{ url: origin || '/' }],
    paths,
    tags: [
      { name: 'content', description: 'Published entries. ETag/304 revalidation, gzip, server-side list cache.' },
      { name: 'counters', description: 'Up/down votes and totals for counter fields. Separate from entry payloads on purpose: voting never invalidates content caches.' },
      { name: 'schema', description: 'Schema read and apply.' },
      { name: 'transfer', description: 'Export, import, bulk URL rewrite.' },
      { name: 'media', description: 'Media upload.' },
      { name: 'tools', description: 'Every MCP tool over plain REST: POST the tool arguments as JSON. Same registry as /mcp, so the two never drift.' },
      { name: 'mcp', description: 'JSON-RPC transport for agents.' },
      { name: 'meta', description: 'This document.' },
    ],
    components: {
      securitySchemes: { bearerKey: { type: 'http', scheme: 'bearer', description: 'Project API key (yn_...). Read scope for content, write scope for editing endpoints. MCP access is a separate per-key opt-in for /mcp only.' } },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } }, required: ['error'] },
        Entry: { type: 'object', description: 'The published snapshot: every schema field, plus slug, published_at and updated_at (ISO 8601 UTC). Counter fields are absent; read them from the counters endpoints.', properties: { slug: { type: 'string' }, published_at: { type: 'string' }, updated_at: { type: 'string' } }, additionalProperties: true },
        CounterTotals: { type: 'object', properties: { up: { type: 'integer' }, down: { type: 'integer' }, changed: { type: 'boolean', description: 'Vote responses only: false when this visitor already voted this way (no-op).' } }, required: ['up', 'down'] },
      },
    },
  };
}
