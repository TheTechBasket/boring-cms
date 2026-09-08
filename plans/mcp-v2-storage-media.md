# MCP v2 + storage/media overhaul

**Goal:** ship all accepted MCP v2 backlog items, fix the slug/editor UX, split storage secrets from recoverable config with a real edit flow, and move media to a multi-storage model with path folders and check-first sync.

## Stage A: MCP v2 (lib/mcp.ts, lib/content.ts, server.ts)

- [ ] update_entry gains `publish: true` option
- [ ] delete_entry tool (write scope, deleteEntry already exists)
- [ ] batch_create_entries: array of {slug, data}, per-item results, one transaction, optional publish
- [ ] list_entries `updated_since` filter; response items carry slug, updated_at, published_at
- [ ] 429 rate_limited body carries `retry_after` seconds computed from the bucket
- [ ] json fields: string values that parse as JSON get parsed on MCP writes (fix double-encode)

## Stage B: entry editor and slug (lib/content.ts, lib/views.ts, server.ts)

- [ ] Fix slug collision: a user schema field named `slug` with an empty value no longer wipes the native slug from the publish snapshot
- [ ] Editor status card shows the native entry slug (copyable), not only the ID
- [ ] Schema field named `slug` gets help text pointing at the native slug
- [ ] Sidebar card: API response preview (published JSON now, or what publish would produce) plus the endpoint URL

## Stage C: storage registry v2 (core migration, lib/store.ts, server.ts, lib/views.ts)

- [ ] New core `storages` table: plain endpoint/bucket/region/access key id/public URL, AES-GCM encrypted secret only
- [ ] Auto-migrate legacy `storage_<name>` encrypted settings rows into the table on boot
- [ ] Global settings: storage list with Edit; edit form pre-fills non-secret fields, secret blank keeps existing
- [ ] Delete storage action; probe still runs on save

## Stage D: media multi-storage (lib/media.ts, server.ts, lib/views.ts, public/admin.js)

- [ ] Remove the group/folder feature (UI, routes, filter; keep DB column dormant)
- [ ] All configured storages usable at once: upload form storage select defaulting to the project setting, rows pinned via base_url when not on the default
- [ ] Storage filter toggle in the media gallery
- [ ] Nested key adoption from S3 (keys with `/`), folder drill-down gallery by key path
- [ ] Sync becomes check-first: dry-run report of adoptable/missing files, then selective apply
- [ ] Extension-based image previews for adopted files via the wsrv proxy

**Verification:** per stage: `pnpm css`, `npx tsc --noEmit`, `pnpm smoke` (smoke extended for MCP v2 tools and storage edit), commit locally, no push.

**After:** notify the design peer session with what changed and that a server restart is needed.
