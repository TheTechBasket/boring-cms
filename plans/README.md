# Plans index

## Active

- [promotion.md](promotion.md) (local only): launch basics. No community posts or submissions for now (Amit 2026-11-05).
- [ops-2026-10.md](ops-2026-10.md) (local only): hosted instance follow-ups.
- [backup.md](backup.md): backup and restore design. Keeps SECRET_KEY out of routine data backups.

## Notes

- Build time: 2026-11-05, `pnpm verify:pack`, 19 s.

## Backlog

- Single binary: `deno compile` (deno 2.6.8 runs the server unmodified) or `bun build --compile` (works since bun 1.4.2 added `node:sqlite`). Keep sharp optional.
- Webhook as a build trigger, when a consumer wants it: fire `entry.live` at go-live (the webhook fires at `publish_entry`, so a scheduled post is still hidden; persist the last-fired mark), coalesce to one POST per N minutes, per-project event filter, durable retries (outbox table, see the `ponytail:` note in `lib/webhooks.ts`). Polling `GET /api/v1/<project>/_version` covers this today.
- Relation field: API expansion of referenced entries on `?include=`, when a consumer needs it.
- API list filtering and sorting from the collection schema: `?field=value`, `?sort=-date`.
- Media alt text and caption fields, included in the copy-markdown snippet.
- Human slug per collection: a designated field gives `/blog-posts/my-post` URLs. UUID stays canonical.
- API request stats per key and day (calls, 429s, last endpoint): in-memory counters flushed on a timer, never a write per request. The rate limiter must not throttle the flush or admin reads.
- Manual verify, code shipped: real image upload with sharp installed; S3 backend and custom domain against live R2; browser passkey and live Google login; `.mcp.json` against a live Claude Code session.
- Schema mutation over MCP (`add_field`, `remove_field`): revisit if migrations keep needing the dashboard.
- Media virtual folders (filebird-lite style): stored only in the CMS, no key rewrites. Spec pending.
- Per-project "Convert image uploads to WebP" toggle, off by default: about 30 lines in `media.ts` on the sharp path. Skip webp, svg, animated gif. Pairs with `bulk_rewrite_refs`.

## Do not redo

- Pocketbase per project: process management eats the savings, and its admin UI is not a CMS editor.
- MySQL or Mongo in v1: SQLite covers CMS workloads. Add an adapter only for a real need.
- GraphQL in v1: delivery layer is a seam, add when a consumer needs it.
- WordPress WXR import in the CMS: export/import covers it, with a one-off script for WXR to JSON.
- MCP registries (mcp.so, Smithery, official registry): our MCP server is per project and private, so there is no public URL to register.
