# Plans index

## Active

- [Stage 3: media](stage-3-media.md) — uploads, local + S3-compatible backend, pre-generated variants.
- [Stage 4: WP migration](stage-4-wp-import.md) — WXR importer, media pull, redirect map, import report.
- [Stage 5: auth extras](stage-5-auth.md) — passkeys, Google OAuth from UI, Secure cookie/trust-proxy.
- [Stage 6: MCP per project](stage-6-mcp.md) — Streamable HTTP MCP, scoped API keys, agent read/write tools.

Order: 3 then 4 (importer needs media backend); 5 and 6 independent after that.

## Backlog

(none)

## Rejected findings

- Wrap Pocketbase per project instead of building: process-per-project management (ports, upgrades, backups) eats the savings, and its admin UI is not a CMS editor, so the CMS half gets built anyway. 2026-09-06.
- MySQL/Mongo support in v1: SQLite covers CMS workloads; adapter only if a real need appears. 2026-09-06.
- GraphQL in v1: delivery layer is a seam, plug in later if a consumer needs it. 2026-09-06.

## Shipped history

- 2026-09-06 Stage 2 content: native-TS conversion (Node 24 type stripping), SECRET_KEY rename + first-boot .env autogen, per-project migrations, collections builder with auto slugs, entries with field-delta revisions and atomic revert (keep 20 / 90 days), publish materialization to published_data, REST API v1 with hashed Bearer keys and content_version ETags/304, sidebar admin with project switcher, vendored marked ESM preview, smoke extended end to end. Still open from stage 1 note: Secure cookie flag / trust-proxy.
- 2026-09-06 Stage 1 core: node:http server, node:sqlite (zero deps), scrypt auth, HMAC session cookies, AES-256-GCM settings, per-project DB manager, first-run setup, Server-Timing + slow-query log, smoke script. Note for stage 2: add Secure cookie flag / trust-proxy config.
