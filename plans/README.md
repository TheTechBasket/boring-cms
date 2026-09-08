# Plans index

## Active

(none — all planned stages shipped)

## Backlog

- Publish webhooks: per-project URL(s) POSTed on publish/unpublish (fires Netlify build hooks, cache purges). Small, high value for static-site consumers.
- Relation field type: entry reference to another collection (stored as UUID, picker in editor, expanded in API on `?include=`). Deferred hard: house style is no stored relationships, content scan/search covers linking; build only if a real case defeats search.
- API list filtering/sorting: `?field=value`, `?sort=-date` on the read API, driven by the collection schema. Pairs with stage 5 types.
- Media alt text + caption fields on the media row, included in the copy-markdown snippet.
- Human slug option per collection: designate a field as public slug so API URLs read `/blog-posts/my-post` instead of UUID (UUID stays canonical).
- Nightly per-project SQLite backup (single-file copy, rotate N) plus media manifest.
- API request stats: per-key/per-day counters (calls, 429s, last endpoint hit) shown on the API keys page. In-memory counters only, flushed to a `request_stats` meta-style table on a timer (not per-request write) so it never adds DB I/O to the hot path; the rate limiter must never throttle its own stats flush or admin reads, only external API traffic.
- Stage 3 leftovers (manual verify only, code shipped): real image upload with sharp installed; S3 backend against live R2 credentials.

## Rejected findings

- Wrap Pocketbase per project instead of building: process-per-project management (ports, upgrades, backups) eats the savings, and its admin UI is not a CMS editor, so the CMS half gets built anyway. 2026-09-06.
- MySQL/Mongo support in v1: SQLite covers CMS workloads; adapter only if a real need appears. 2026-09-06.
- GraphQL in v1: delivery layer is a seam, plug in later if a consumer needs it. 2026-09-06.

## Shipped history

- 2026-09-07 Stage 10 docs, login hardening, DRY, polish: REST API docs card on the API keys page (all endpoints, params, auth, ETag/304, live per-collection URLs, curl example); password login can be disabled from Account once a passkey or Google exists (global `password_login` setting, self-healing when alternatives vanish, FORCE_PASSWORD_RESET as break-glass, login page hides the form, POST /login 403s); datalist group suggestions replaced with clickable chips (`data-fill`); "Projects overview" removed from the switcher (empty value is a no-op placeholder); main content capped at `max-w-6xl` leaving room for a future right sidebar; DRY pass in views (popover, selectField, checkbox, preBlock, settingsKeyList, FILE_INPUT_CLASS helpers); sharp corners everywhere per the dribbble reference; popover entrance animation with reduced-motion guard; smoke coverage for all of it.
- 2026-09-06 Stage 9 media ergonomics + shared storage: global storage registry (add an S3 bucket once in Global settings as encrypted `storage_<name>` JSON, any project selects it; legacy per-project s3_* still works); content URLs use the storage public domain directly, never the CMS host or project slug (slug is permanent anyway, rename changes the name only); media groups (`folder` column, free text, datalist), search box and group filter on the media page and in the image-field picker; upload a new image straight from the picker (fetch, json=1); project icon column (emoji, logo URL, or auto initials avatar) shown in list, sidebar, switcher; MCP snippet uses the live request origin and key creation shows the complete `.mcp.json` with the key filled in; Transfer page pairs schema export with Apply schema. Manual verify open: live R2 with a custom domain.
- 2026-09-06 Stage 8 auth extras: hand-rolled WebAuthn passkeys (minimal CBOR decoder, COSE to JWK, ES256/RS256 assertion verify with counter clone check, signed stateless challenge cookies), Account page (passkey list/add/remove, change password), Google OAuth code flow with PKCE via plain fetch gated on encrypted global settings (admin email only), TRUST_PROXY=1 for x-forwarded-proto and Secure session cookies, login page passkey/Google buttons, smoke coverage with a simulated authenticator (real signatures, fake device). Manual browser passkey + live Google flow verification still open.
- 2026-09-06 Stage 7 MCP per project: hand-rolled JSON-RPC 2.0 endpoint at POST /mcp/:project (initialize, tools/list, tools/call, ping); Bearer API keys gain a scope column (read default, write unlocks create/update/publish/unpublish tools); writes go through the content layer so agent edits are revertable revisions; per-key in-memory token bucket (60/min, 429 Retry-After); scope select and MCP config snippet on the API keys page; smoke coverage; README section. Manual .mcp.json verification against a live Claude Code session still open (stage 3 leftovers style).
- 2026-09-06 Stage 6 media v2: opt-in variants (per-upload checkbox, `media_variants` project default, `_320`/`_1024` key suffixes, never generated unless asked); wsrv.nl proxy previews when `s3_public_url` set (no local copies); browser-to-bucket presigned PUT upload with SHA-256 hashing and server-side fallback; per-image "where used" LIKE scan with entry links (no stored relationships); Sync storage reconcile (adopt outside uploads, report missing objects); ListObjectsV2 + presign in the SigV4 client; smoke coverage; README section.
- 2026-09-06 Stage 5 field constraints: full standard field options per field (required, help, placeholder, default, min/max/step, minlength/maxlength, pattern, accept) with an in-row editor, conventional limits as placeholders, blank clears; enforced server-side (400 rerender keeps input) and as native browser attributes; image field type with media picker; options travel in the schema export.
- 2026-09-06 Stage 4 export/import: collection/project/schema JSON exports; JSON+CSV import with in-browser field mapping (map/create/skip), dry-run report, unique-field idempotent re-import, temp-file pending state; idempotent schema apply (create/update, deletions opt-in); Transfer page in the sidebar; smoke coverage; README section.
- 2026-09-06 Stage 3 media: multipart parser (buffered, 50 MB), storage backend interface with local disk + hand-rolled S3 SigV4 (R2/MinIO/S3), content-hash keys, optional sharp variants (thumb 320 / medium 1024), media library UI with copy-markdown, public serve route with immutable caching or public-URL redirect, smoke coverage.
- 2026-09-06 Stage 2 content: native-TS conversion (Node 24 type stripping), SECRET_KEY rename + first-boot .env autogen, per-project migrations, collections builder with auto slugs, entries with field-delta revisions and atomic revert (keep 20 / 90 days), publish materialization to published_data, REST API v1 with hashed Bearer keys and content_version ETags/304, sidebar admin with project switcher, vendored marked ESM preview, smoke extended end to end. Still open from stage 1 note: Secure cookie flag / trust-proxy.
- 2026-09-06 Stage 1 core: node:http server, node:sqlite (zero deps), scrypt auth, HMAC session cookies, AES-256-GCM settings, per-project DB manager, first-run setup, Server-Timing + slow-query log, smoke script.

## Deferred (end of log)

- Direct WordPress (WXR) import inside the CMS: rejected 2026-09-06. Universal export/import (stage 4) covers migration; WXR converts to JSON with a one-off external script. Revisit only if the external-script path proves painful across several real site migrations.
