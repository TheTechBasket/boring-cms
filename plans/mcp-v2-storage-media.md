# MCP v2 + storage/media overhaul

**Goal:** ship all accepted MCP v2 backlog items, fix the slug/editor UX, split storage secrets from recoverable config with a real edit flow, and move media to a multi-storage model with path folders and check-first sync.

## Stage A: MCP v2 (lib/mcp.ts, lib/content.ts, server.ts)

- [x] update_entry gains `publish: true` option
- [x] delete_entry tool (write scope, deleteEntry already exists)
- [x] batch_create_entries: array of {slug, data}, per-item results, one transaction, optional publish (updateEntry moved to savepoints)
- [x] list_entries `updated_since` filter; response items carry slug, updated_at, published_at
- [x] 429 rate_limited body carries `retry_after` seconds computed from the bucket
- [x] json fields: string values that parse as JSON get parsed on MCP writes (fix double-encode)

## Stage B: entry editor and slug (lib/content.ts, lib/views.ts, server.ts)

- [x] Fix slug collision: a user schema field named `slug` with an empty value no longer wipes the native slug from the publish snapshot (plus read-path backfill)
- [x] Editor status card shows the native entry slug (copyable), not only the ID
- [x] Schema field named `slug` gets help text pointing at the native slug
- [x] Sidebar card: API response preview (published JSON now, or what publish would produce) plus the endpoint URL

## Stage C: storage registry v2 (core migration, lib/store.ts, server.ts, lib/views.ts)

- [x] New core `storages` table: NOT built. Kept encrypted `storage_<name>` blobs; edit flow decrypts and pre-fills non-secret fields, secret stays write-only. No migration needed.
- [x] Auto-migrate legacy rows: not needed under the kept-blob design
- [x] Global settings: storage list with Edit; edit form pre-fills non-secret fields, secret blank keeps existing
- [x] Delete storage action; probe still runs on save (skip_test bypass kept)

## Stage D: media multi-storage (lib/media.ts, server.ts, lib/views.ts, public/admin.js)

- [ ] Remove the group/folder feature (UI, routes, filter; keep DB column dormant)
- [ ] All configured storages usable at once: upload form storage select defaulting to the project setting, rows pinned via base_url when not on the default
- [ ] Storage filter toggle in the media gallery
- [ ] Nested key adoption from S3 (keys with `/`), folder drill-down gallery by key path
- [ ] Sync becomes check-first: dry-run report of adoptable/missing files, then selective apply
- [ ] Extension-based image previews for adopted files via the wsrv proxy

**Verification:** per stage: `pnpm css`, `npx tsc --noEmit`, `pnpm smoke` (smoke extended for MCP v2 tools and storage edit), commit locally, no push.

**After:** notify the design peer session with what changed and that a server restart is needed.
