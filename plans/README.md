# Plans index

## Active

- Stage 6: media v2. Variants opt-in only: never generated unless asked, per-upload checkbox and a per-project default; variant identifier is a key suffix (`<hash>-<stem>_320.ext` / `_thumb.ext`); per-project toggle to disable variants entirely. No local copies and no self-hosted resize proxy: previews and galleries go through wsrv.nl (`https://wsrv.nl/?url=<public url>&w=320`) when the file has a public URL, so resizing/format is on the fly with zero server work. With S3 configured, uploads go browser-to-bucket directly via presigned PUT (server signs, never proxies bytes). Image usage search: per-image "where used" scan of entry data for the key with a count and entry list, no stored relationship; same scan powers a simple gallery view of images alongside the content that references them. S3 sync: reconcile button lists bucket objects vs media table, adopts files uploaded outside the CMS as rows, flags rows whose object was deleted outside (remove or re-upload).
- [Stage 7: MCP per project](stage-6-mcp.md) — Streamable HTTP MCP, scoped API keys, agent read/write tools.
- [Stage 8: auth extras](stage-5-auth.md) — passkeys, Google OAuth from UI, Secure cookie/trust-proxy. Deprioritized: waits until the rest ships.

Order: 6, 7; 8 last.

## Backlog

- Publish webhooks: per-project URL(s) POSTed on publish/unpublish (fires Netlify build hooks, cache purges). Small, high value for static-site consumers.
- Relation field type: entry reference to another collection (stored as UUID, picker in editor, expanded in API on `?include=`). Deferred hard: house style is no stored relationships, content scan/search covers linking; build only if a real case defeats search.
- API list filtering/sorting: `?field=value`, `?sort=-date` on the read API, driven by the collection schema. Pairs with stage 5 types.
- Media alt text + caption fields on the media row, included in the copy-markdown snippet.
- Human slug option per collection: designate a field as public slug so API URLs read `/blog-posts/my-post` instead of UUID (UUID stays canonical).
- Nightly per-project SQLite backup (single-file copy, rotate N) plus media manifest.
- Stage 3 leftovers (manual verify only, code shipped): real image upload with sharp installed; S3 backend against live R2 credentials.

## Rejected findings

- Wrap Pocketbase per project instead of building: process-per-project management (ports, upgrades, backups) eats the savings, and its admin UI is not a CMS editor, so the CMS half gets built anyway. 2026-09-06.
- MySQL/Mongo support in v1: SQLite covers CMS workloads; adapter only if a real need appears. 2026-09-06.
- GraphQL in v1: delivery layer is a seam, plug in later if a consumer needs it. 2026-09-06.

## Shipped history

- 2026-09-06 Stage 5 field constraints: full standard field options per field (required, help, placeholder, default, min/max/step, minlength/maxlength, pattern, accept) with an in-row editor, conventional limits as placeholders, blank clears; enforced server-side (400 rerender keeps input) and as native browser attributes; image field type with media picker; options travel in the schema export.
- 2026-09-06 Stage 4 export/import: collection/project/schema JSON exports; JSON+CSV import with in-browser field mapping (map/create/skip), dry-run report, unique-field idempotent re-import, temp-file pending state; idempotent schema apply (create/update, deletions opt-in); Transfer page in the sidebar; smoke coverage; README section.
- 2026-09-06 Stage 3 media: multipart parser (buffered, 50 MB), storage backend interface with local disk + hand-rolled S3 SigV4 (R2/MinIO/S3), content-hash keys, optional sharp variants (thumb 320 / medium 1024), media library UI with copy-markdown, public serve route with immutable caching or public-URL redirect, smoke coverage.
- 2026-09-06 Stage 2 content: native-TS conversion (Node 24 type stripping), SECRET_KEY rename + first-boot .env autogen, per-project migrations, collections builder with auto slugs, entries with field-delta revisions and atomic revert (keep 20 / 90 days), publish materialization to published_data, REST API v1 with hashed Bearer keys and content_version ETags/304, sidebar admin with project switcher, vendored marked ESM preview, smoke extended end to end. Still open from stage 1 note: Secure cookie flag / trust-proxy.
- 2026-09-06 Stage 1 core: node:http server, node:sqlite (zero deps), scrypt auth, HMAC session cookies, AES-256-GCM settings, per-project DB manager, first-run setup, Server-Timing + slow-query log, smoke script.

## Deferred (end of log)

- Direct WordPress (WXR) import inside the CMS: rejected 2026-09-06. Universal export/import (stage 4) covers migration; WXR converts to JSON with a one-off external script. Revisit only if the external-script path proves painful across several real site migrations.
