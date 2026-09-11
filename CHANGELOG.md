# Changelog

Version to version upgrade notes. Newest first. Upgrades are `git pull` plus a restart; per-project SQLite migrations apply automatically on the next open of each project database.

## Unreleased

## 0.17.1 (2026-09-11)

- Performance: `bulk_rewrite_refs` now rewrites in a single pass over the entries, independent of how many URL pairs are in the map. v0.17.0 ran one full-table scan per pair (a substring match cannot use an index), so a large map meant hundreds or thousands of whole-table scans and a Cloudflare 504 on real data (2216 pairs timed out; a single pair already took ~55s on prod). The pass now scans each entry once with a combined literal matcher and writes changed rows by primary key. Behavior is unchanged: same exact-URL swap, same no-op on `updated_at`/`published_at`, same single `content_version` bump, same `dry_run` match counts, same `ref_rewrites` audit. No new migration.

## 0.17.0 (2026-09-11)

- Bulk cosmetic ref rewrite, over the API and MCP. A new `bulk_rewrite_refs` MCP tool and `POST /api/v1/<project>/rewrite-refs` endpoint (both write-scope) swap exact full URLs across every entry in one pass, for cosmetic asset migrations like replacing `.png`/`.jpg` links with the `.webp` of the same image. Each pair replaces the URL in both the published snapshot and the draft, deliberately WITHOUT touching `updated_at` or `published_at`, so sitemap `lastmod` stays frozen; a single `content_version` bump forces exactly one rebuild to pick up the change. `old` and `new` must be full `https://` URLs (a bare extension like `.png` is rejected) and must differ. Pass `dry_run: true` to get per-pair match counts and the total entries touched without changing anything. Matching is literal (safe for URLs containing `%` or `_`), drafts are handled safely, and because this bypasses the normal edit trail every live run is recorded in a new per-project `ref_rewrites` audit table (timestamp, pair count, entries touched, the pairs). New migration: `005_ref_rewrites.sql` (adds the `ref_rewrites` table), applied automatically on the next open of each project database.

## 0.16.2 (2026-09-11)

- Readable sidebar labels, version, and Log out. The group labels ("PROJECT", "INSTANCE"), the version line, and the "Log out" control were drawn in the global muted grey, which is a dark grey meant for the light content area; on the always-black sidebar that grey fell to roughly 2.5:1 contrast (below the WCAG AA 4.5:1 minimum), so in light mode the "Log out" control in particular was hard to read. They now use the sidebar's own foreground at reduced opacity, which stays light-on-dark (about 8:1) while still reading as de-emphasized. No behavior change.
- Sidebar animations respect reduced motion. The collapse width transition and the toggle-icon flip are now disabled under `prefers-reduced-motion: reduce`, alongside the existing popover and button-press motion. No new migration.

## 0.16.1 (2026-09-11)

- Sidebar refinements. The project switcher is now a quiet ghost control that fills only on hover (with an up/down affordance), instead of a heavy always-on dark block. The project sub-items (API keys, Import / export) are flat single-line rows instead of a cramped indented group with a left rule, so "Import / export" no longer wraps to two lines. The "Log out" control is a muted icon row at the foot of the nav rather than an outlined button competing for attention. The collapse control uses a sidebar glyph (not a hamburger) and flips to point the other way when the nav is on the rail. Small delight: the current page's icon is tinted in the utility blue, nav rows transition color on hover, and the collapse glyph animates. Behavior and links are unchanged. No new migration.

## 0.16.0 (2026-09-11)

- Collapsible sidebar, one mechanism for every screen. The nav has a single toggle (top of the sidebar) that flips between the full labelled panel and a compact icon rail; there is no longer a separate mobile-drawer code path. On desktop the panel and rail sit inline and the content reflows to fill the freed width; on a phone the slim rail stays pinned to the left and the expanded panel slides over the content with a dim backdrop that closes it on tap. The state is applied before paint (so there is no flash), the desktop choice is remembered per browser, and phones always open on the rail so no page loads with the menu covering the content. The switcher, nav links, and instance links are unchanged in behavior. No new migration.

## 0.15.2 (2026-09-11)

- Project switcher dropdown is readable. On the black sidebar the switcher was rendered with a light color scheme, so the native option list came up as light-grey text on white (nearly invisible) and the closed control had no solid fill. It is now a solid dark control with `color-scheme: dark`, so both the selected project and the open list of projects read as light text on dark, matching the nav. No new migration.

## 0.15.1 (2026-09-11)

- Bigger tap targets on touch devices. On a phone or tablet (any coarse pointer) the admin's buttons, selects, text inputs, sidebar nav links and the "Menu" toggle are now at least 44px tall, so they clear the standard touch-target size instead of the dense 28 to 36px sizing meant for a mouse. The desktop/mouse layout is unchanged: the rule keys off `pointer: coarse`, so nothing shifts on a pointer device. No new migration.

## 0.15.0 (2026-09-11)

- Faster admin loads. The markdown renderer (44 KB) is no longer shipped on every page; it now loads on demand the first time you open a markdown preview in the entry editor, so every other page skips the download entirely. Text responses (HTML, JSON, JS) and the CSS/JS assets are now gzip-compressed on the wire (roughly 60 to 85 percent smaller), on top of the existing immutable caching. Server startup is unchanged. No new migration.
- New look: "Proudly Boring". The admin now has a deliberate identity built for a performance-first tool. Metadata (slugs, keys, counts, timestamps) is set in monospace so it reads like precise tooling; the accent is a solid utility blue on buttons and the primary stat card; the sidebar is black; corners stay sharp. The three-tone stat cards (blue, black, plain) are unchanged in behavior, only recolored. Uses the system monospace font, so it adds no web-font download. No new migration.

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
