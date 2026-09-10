# Changelog

Version to version upgrade notes. Newest first. Upgrades are `git pull` plus a restart; per-project SQLite migrations apply automatically on the next open of each project database.

## Unreleased

## 0.14.1 (2026-09-11)

- Sidebar sub-item is legible when it is the current page. The active nested link (for example "Import / export schema" on the Transfer page) was drawing dark text on the dark active background, so the label and icon vanished into a solid block. It now uses the same inverted foreground as every other active row.

## 0.14.0 (2026-09-11)

- Whole-project backup and restore over the public API, so a build-from-CMS project can safely gitignore its synced content and keep one snapshot as the outage fallback instead of thousands of tracked files. `GET /api/v1/<project>/export` returns a single JSON dump of the schema plus every entry (read-scope key, same shape as the admin export). `POST /api/v1/<project>/import` rehydrates from that dump (write-scope key): an idempotent upsert by slug that applies the schema, then creates or updates each entry and preserves published/draft status. Entries absent from the dump are left alone, a no-op restore bumps nothing (build clients keep their `ETag`/`304`), and `?delete_missing=1` forwards to the schema apply only. Accepts dumps up to 64 MB. No new migration.

## 0.13.1 (2026-09-10)

- MCP access is now editable on existing keys. The API keys table has an "Enable MCP" / "Disable MCP" button per key, so a key created before the MCP opt-in (which defaulted to no MCP access) can be granted access without recreating it. No new migration.
- Admin is usable on mobile. The sidebar is now an off-canvas drawer under a "Menu" button on narrow screens (opened and closed with a CSS-only toggle, no extra JS), instead of a fixed 240px panel that squeezed the content column off the screen. Content padding tightens on small viewports; wide tables already scroll horizontally.
- Project switcher restyled. The dropdown now shows the current project's avatar on the left and a chevron on the right (native select underneath, still no JS), instead of a plain box with the icon crammed into the option text.
- Sidebar nav tidied. The current project's name is no longer repeated below the switcher, and "API keys" and "Import / export schema" (was "Transfer") are now nested under "Settings & secrets" as a sub-list.

## 0.13.0 (2026-09-10)

- MCP access is now an opt-in capability per API key, separate from read/write scope. Creating a key has an "Enable MCP access" checkbox: a read + MCP key exposes read-only tools over `/mcp/<project>`, a read + write + MCP key exposes the editing tools too, and a key without it is refused at the MCP endpoint (403) while still working on the REST API. Existing keys default to no MCP access; the keys table shows an MCP tag on keys that have it. A per-project migration adds the `mcp` column automatically.
- Explicit light/dark theme, no OS auto-switch. A theme toggle in the sidebar sets the choice and persists it in the browser (applied before first paint, so no flash). Dark mode now follows the toggled `.dark` class rather than the operating-system setting.
- Sidebar redesign: fresh Solar duotone icons throughout, project-scoped and instance-scoped navigation split into clearly labelled "Project" and "Instance" groups (each settings link annotated as covering settings and secrets), and the signed-in email removed from the sidebar.

## 0.12.0 (2026-09-10)

- Revision history shows a diff, not just a revert. Each revision in the entry editor has a Diff button that opens a centered modal with a line-level diff per changed field: only the changed lines show (removed in red, added in green) with a little context, and long unchanged runs collapse to a count, so the modal reflects what changed instead of dumping the whole field body. Large diffs stay scrollable inside the modal. The Revert button lives inside that modal, so a revert can no longer be clicked by accident.
- Republish surfaced for entries with unpublished draft edits. A published entry whose draft differs from what the API serves (after an edit or a revert) now shows a "Draft has changes that are not live yet" note and a Republish button in the editor, instead of forcing an unpublish/publish cycle. MCP authoring calls (`create_entry`, `update_entry`) return `has_unpublished_changes: true` while a republish is pending, and `get_entry` accepts `draft: true` to read the latest saved version with that flag. The flag is authoring-only and omitted when false; the public read API still serves published data only.
- Field delete is gated. Removing a field on the collection page now asks to confirm and states how many of the total entries carry a value for it, plus how unique those values are (every value unique, all share one value, or a distinct-count). Each field row also shows a live `filled/total` count. The remove itself is not stored as a revision, so the confirmation says so.
- Versioned benchmark suite in `bench/` (driver, matrix orchestrator, summary generator, constraints doc). Runs the full CRUD/media/schema surface against a fresh temp data dir per run, pinned to 1/2/4 vCPUs, on node/bun/deno; results committed under `bench/results/v<version>/`, including an interactive HTML report (`report.html`: throughput bars per phase, CPU/RSS timelines with phase bands). No change to the served app.
- `npx boring-cms` works: `bin/boring-cms.js` launcher plus `bin`/`files` entries in package.json. Runs the TypeScript sources natively (engines bumped to Node >=24), data and generated `.env` land in the invoking directory. Publish to npm still pending.

## 0.11.0 (2026-09-09)

- Link contrast: admin links get a dedicated `--link` token (readable violet, 7:1 on white; brighter lavender in dark mode) instead of the pale `primary` background color, which made Transfer export links and inline links nearly invisible.
- Destructive row actions (Revoke key, Delete media) render in the destructive color instead of plain ghost text.
- REST API endpoint table no longer pushes its description column off the card edge; long endpoint paths wrap.
- Static asset caching: admin.css, admin.js and vendor scripts are linked with `?v=<mtime>` so browsers pick up new builds after a deploy restart. Versioned URLs are served with `Cache-Control: public, max-age=31536000, immutable`; bare URLs get `no-cache` with `Last-Modified`/304 revalidation.
- Rate-limited API endpoints (schema apply, media upload, MCP) now send standard `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` headers on every response, alongside the existing `Retry-After` on 429.

## 0.10.0 (2026-09-09)

- Schema management over the API-key surface. MCP gains `get_schema` and `describe_field_types` (read scope) plus `create_collection`, `add_field`, `update_field`, `remove_field` and `apply_schema` (write scope). REST mirrors it: `GET /api/v1/<project>/schema`, `GET /api/v1/<project>/field-types`, and `POST /api/v1/<project>/schema` applying a full schema document (collections matched by slug, field lists replaced; `?delete_missing=1` opts into deleting absent collections with their entries).
- Field type registry: `FIELD_TYPES`, `FIELD_OPTIONS` and the introspection payload all derive from one registry in `lib/content.ts` (per type: value shape plus the options it accepts), so a new type shows up in the API by itself. Schema tools reject options that do not apply to the field's type.
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
