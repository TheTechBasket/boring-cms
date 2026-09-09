# Changelog

Version to version upgrade notes. Newest first. Upgrades are `git pull` plus a restart; per-project SQLite migrations apply automatically on the next open of each project database.

## 0.10.0 (2026-09-09)

- Sidebar marks the current section: black active row (white in dark mode) with inverted icon, driven by `aria-current` set client-side.
- Contrast: `muted-foreground` darkened in light mode (4.6:1 to 5.9:1 on gray chips and badges) and lightened in dark mode; page declares `color-scheme` so native controls (project switcher, scrollbars) follow the theme.
- Publish webhooks: per-project URL plus optional HMAC secret in project settings, fired whenever published content changes (publish, unpublish, published-entry edit or delete).
- REST list endpoints accept `updated_since` (parity with MCP `list_entries`) for incremental static-site builds.
- Passkeys can be named when added (account page input, sent as `name` to `/webauthn/register`); unnamed ones still save as "Passkey".
- `.env.example` documents `TRUST_PROXY=1`, required behind a TLS-terminating proxy for the WebAuthn origin check and Secure session cookies.
- Headless media upload: `POST /api/v1/<project>/media` (multipart, write-scope Bearer key, same rate limit as MCP) returns `{id, key, url}` with the full public URL. MCP gets a matching `upload_media` tool (base64 body, fits ~6 MB files under the 8 MB request cap).
- Folder prefixes on upload: optional `path` field (validated segments, no traversal) stores objects under a nested key like `uploads/2026/09/ab12cd34-photo.jpg`; needs a storage with a public base URL. Presign accepts `path` too, and register accepts nested keys on such storages.
- `adoptableKey` rejects dot-only path segments (`.`/`..`) everywhere.

## 0.9.0 (2026-09-08, from 0.1.0)

Product named **Boring CMS** (repo stays `yncms`; cookie/settings crypto salts keep the old name on purpose so existing sessions and encrypted settings survive). Version now shows in the admin sidebar.

### Editor and schema

- Add-field takes an optional explicit field id alongside the label; blank still derives it from the label. Reserved names and duplicates get suffixed either way.
- Built-in system fields (`slug`, `updated_at`, `published_at`) appear as non-deletable rows in the fields editor so redundant custom copies are easy to spot and remove.
- Native entry slug is editable as a normal field in the entry editor: pick one at creation (blank = generated id) or rename later. A rename updates the published snapshot's slug and bumps the content version; the API URL changes with it.
- `unique` field option, enforced on dashboard, REST-facing writes and MCP alike; the rejection names the entry holding the value.
- Relation field type: target collection picker, multiple, one-save type switch from text.
- Reserved field names (`slug`, `updated_at`, `published_at`) are never minted for user fields; a field labeled that way gets a suffixed name.
- Datetime field type; image preview on text fields holding an image path.

### Revisions

- Default retention: keep 2 per entry (was 20), auto-delete after 15 days (was 90).
- Per-collection setting: default, off, 5 or 20. Off records no new revisions (for collections agents rewrite constantly); existing history ages out instead of being wiped.

### MCP and API

- MCP v2 tools: `update_entry` with `publish`, `delete_entry`, `batch_create_entries` (one transaction, per-item results, 200 item cap), `list_entries` with `updated_since`, `retry_after` seconds in 429 bodies.
- 8 MB MCP request body limit with a clean 413 carrying `limit_bytes`.
- `updated_at` always reflects the row write clock (a user data field with that name no longer shadows it); timestamps serialize as ISO 8601 UTC and `updated_since` accepts ISO or SQL format cursors.
- Rate limit configurable per project from the dashboard (was env var).

### Media and storage

- Multi-storage media: any registered storage at upload time, storage badge and filter, check-first sync with dry-run report, nested S3 key adoption.
- Storage edit flow: non-secret fields recoverable, secrets write-only.
- API response preview card in the editor (live vs after next publish).

## 0.1.0 (2026-09-06)

Initial release, stages 1 to 10 in three days:

- Core: `node:http` server, `node:sqlite`, zero runtime dependencies, scrypt auth, HMAC session cookies, AES-256-GCM encrypted settings, per-project SQLite databases, first-run setup.
- Content: collections builder, entries with field-level backward-delta revisions and atomic revert, publish materialization to `published_data`, REST API v1 with hashed Bearer keys and content-version ETags.
- Media: multipart upload, local disk and hand-rolled S3 SigV4 backends (R2/MinIO/S3), content-hash keys, optional sharp variants, presigned browser-to-bucket uploads.
- Transfer: JSON/CSV import with field mapping and dry-run, collection/project/schema exports, idempotent schema apply.
- Field constraints: required, help, placeholder, default, min/max, length, pattern, accept; enforced server-side and as native browser attributes.
- MCP per project: hand-rolled JSON-RPC 2.0 endpoint, scoped API keys (read/write), per-key rate limit.
- Auth extras: hand-rolled WebAuthn passkeys, Google OAuth with PKCE, optional password-login disable.
- Admin UI: server-rendered template strings, vanilla JS, Tailwind-built stylesheet committed to the repo, REST API docs on the keys page.
