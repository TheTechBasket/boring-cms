# Plans index

## Active

- [Stage 4: universal export/import](stage-4-import-export.md) — JSON/CSV content export/import with in-browser field mapping and dry-run check, plus schema-as-code: full project schema exportable, writable by hand/code, applied idempotently.
- Stage 5: field schema constraints (promoted from backlog). Per-field rules (required, min/max length, number range, regex, enum options) enforced live in the editor, in the import dry-run, and in createEntry/updateEntry. Rules editor on the field row; rules travel inside the schema export. Catches content bugs at write time.
- Stage 6: media v2. Variants opt-in only: never generated unless asked, per-upload checkbox and a per-project default; variant identifier is a key suffix (`<hash>-<stem>_320.ext` / `_thumb.ext`). S3 uploads keep a local copy for instant admin preview (gallery never round-trips to bucket); per-project toggle to disable thumbnails entirely. Optional on-the-fly resize proxy route (`/media/<project>/<key>?w=320`, sharp required, disk-cached) so previews and galleries need no pre-generated variants at all.
- [Stage 7: auth extras](stage-5-auth.md) — passkeys, Google OAuth from UI, Secure cookie/trust-proxy.
- [Stage 8: MCP per project](stage-6-mcp.md) — Streamable HTTP MCP, scoped API keys, agent read/write tools.

Order: 4, 5, 6; 7 and 8 independent after that.

## Backlog

- Publish webhooks: per-project URL(s) POSTed on publish/unpublish (fires Netlify build hooks, cache purges). Small, high value for static-site consumers.
- Relation field type: entry reference to another collection (stored as UUID, picker in editor, expanded in API on `?include=`). Needed once content grows past flat collections.
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

- 2026-09-06 Stage 3 media: multipart parser (buffered, 50 MB), storage backend interface with local disk + hand-rolled S3 SigV4 (R2/MinIO/S3), content-hash keys, optional sharp variants (thumb 320 / medium 1024), media library UI with copy-markdown, public serve route with immutable caching or public-URL redirect, smoke coverage.
- 2026-09-06 Stage 2 content: native-TS conversion (Node 24 type stripping), SECRET_KEY rename + first-boot .env autogen, per-project migrations, collections builder with auto slugs, entries with field-delta revisions and atomic revert (keep 20 / 90 days), publish materialization to published_data, REST API v1 with hashed Bearer keys and content_version ETags/304, sidebar admin with project switcher, vendored marked ESM preview, smoke extended end to end. Still open from stage 1 note: Secure cookie flag / trust-proxy.
- 2026-09-06 Stage 1 core: node:http server, node:sqlite (zero deps), scrypt auth, HMAC session cookies, AES-256-GCM settings, per-project DB manager, first-run setup, Server-Timing + slow-query log, smoke script.

## Deferred (end of log)

- Direct WordPress (WXR) import inside the CMS: rejected 2026-09-06. Universal export/import (stage 4) covers migration; WXR converts to JSON with a one-off external script. Revisit only if the external-script path proves painful across several real site migrations.
