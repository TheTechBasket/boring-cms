# Plans index

## Active

- [Stage 4: universal export/import](stage-4-import-export.md) — JSON/CSV export, import with in-browser field mapping and dry-run schema check, works for any source platform.
- [Stage 5: auth extras](stage-5-auth.md) — passkeys, Google OAuth from UI, Secure cookie/trust-proxy.
- [Stage 6: MCP per project](stage-6-mcp.md) — Streamable HTTP MCP, scoped API keys, agent read/write tools.

Order: 4, then 5 and 6 independent.

## Backlog

- Stage 7: field schema constraints. Per-field validation rules (required, min/max length, number range, regex, enum options) enforced in the editor, the import dry-run, and createEntry/updateEntry. Adds a small rules editor on the field row.
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
