# Plans index

## Active

(none)

## Backlog

- Stage 2: content engine (collections builder, entries, publish materialization, REST API + keys).
- Stage 3: media (local + S3-compatible backend, sharp resize).
- Stage 4: WP migration (WXR importer, media pull, redirect map).
- Stage 5: auth extras (passkey, Google OAuth from UI).
- Stage 6: MCP per project.

## Rejected findings

- Wrap Pocketbase per project instead of building: process-per-project management (ports, upgrades, backups) eats the savings, and its admin UI is not a CMS editor, so the CMS half gets built anyway. 2026-09-06.
- MySQL/Mongo support in v1: SQLite covers CMS workloads; adapter only if a real need appears. 2026-09-06.
- GraphQL in v1: delivery layer is a seam, plug in later if a consumer needs it. 2026-09-06.

## Shipped history

- 2026-09-06 Stage 1 core: node:http server, node:sqlite (zero deps), scrypt auth, HMAC session cookies, AES-256-GCM settings, per-project DB manager, first-run setup, Server-Timing + slow-query log, smoke script. Note for stage 2: add Secure cookie flag / trust-proxy config.
