# Changelog

Version to version upgrade notes. Newest first. Upgrades are `git pull` plus a restart; per-project SQLite migrations apply automatically on the next open of each project database.

## 0.24.0 (2026-09-26)

- New field type `countermap`: one field holding named counters per entry (reactions, poll options, tallies), next to the existing `counter`, which is unchanged. Vote with `POST /api/v1/<project>/<collection>/<entry>/counters/<field>/<key>`; a key is created on its first vote and must match `^[A-Za-z0-9_.:-]{1,64}$` (else 400). Response: `{key, count, changed}` for public votes, `{key, count}` for key-access bumps. A key `group:option` holds one option per visitor per group, so voting another option of the group moves the vote; a key without `:` takes one vote per visitor. Dedupe, 24h window and per-IP limit match counter votes. Key-access fields take `?by=n` (may be negative, floor 0). Option `maxKeys` (default 64, max 1024) caps distinct keys per entry: a new key past it gets 409, existing keys keep counting. The counters read endpoints return countermap fields as `{key: count}` (`{}` when empty) beside counter fields' `{up, down}`. Stored in the existing counters table, no migration.
- Benchmark v2 (`bench/bench2.mjs` + `bench/run2.sh`): asks the server for its field types and generates per-type write/read phases plus counter and countermap vote phases automatically, so every new field type is benchmarked with zero driver changes. Results in `bench/results-v2/`, seeded with a node 2 vCPU history from v0.19.1 (one version before the counter field) through v0.24.0. v1 bench and its result history stay frozen for comparability.
- Admin polish: the collapsed sidebar stacks the brand mark over the toggle (no more overlap in the rail); the entry editor gets required-field markers, width-capped number and date inputs, and a Save changes button in the status card that is enabled only while the form differs from its loaded values.

## 0.23.0 (2026-09-22)

- Fix: API list `limit`/`offset` are now coerced, floored and clamped (limit 1 to 100, offset never negative), so a string, negative or huge value from the query string cannot become `LIMIT -5` or an unbounded scan. No migration.
- Fix: `updated_since` given as bare ISO without a zone (`2026-01-02T03:04:05`) is now read as UTC instead of server-local time, so incremental pulls no longer shift the cursor by the timezone offset. No migration.
- Fix: the API `ETag` now folds in `max(updated_at)` of the live published rows, so a republish that keeps the same content version still flips the tag and cached list builds refresh. The tag stays an opaque HMAC. No migration.
- Fix: counter totals cached in memory are rebound to the live database handle on every vote/read, and idle close now flushes then forgets per-project state (project delete flushes too). Before, a handle reopened after idle close left flushes writing through a dead handle and dropped votes. No migration.
- Fix: every query on a project database now refreshes its idle timer, so a busy project is never closed mid-traffic after 5 quiet minutes on paper. No migration.
- Password change now revokes every other session for the user and keeps only the current one, from both the forced reset page and the account page. A stolen cookie stops working after a reset. No migration.
- Login now has a per-IP rate limit (10 attempts/min) checked before the password hash, slowing credential brute force. Failed logins still return the same 401 page. No migration.
- Add-field form: the "apply anyway" override checkbox is now hidden until Required is ticked, since that is the only add-time rule that can fail existing entries, and its label now matches the edit form's wording. No migration.
- Performance: hot read paths now cache per content generation (content version, API key lookup, project row by slug, published entry id, single-entry responses), invalidated by any write to content, project or key tables. Single published-entry reads are up ~36% and media re-uploads ~57% on the 1 vCPU benchmark; overall throughput on comparable phases is back level with 0.22.0 despite the new checks. No migration.
- Performance: the server (npm start and the benchmark harness) sets `MALLOC_MMAP_THRESHOLD_=1048576` so scrypt's 16 MB hashing workspace is returned to the OS after each login instead of being retained by glibc arenas. Peak RSS under a login burst drops by about 60 MB. No migration.
- Media migration checks destination existence with a cheap `exists` (local `existsSync`, S3 `HEAD`) instead of opening a full download stream per object, so large buckets migrate without pulling every byte or leaking open streams. No migration.
- Deleting a project now keeps its `data/media/<slug>` files by default, since they may be hotlinked from other projects or wanted for reuse. The delete form shows the local file count and offers an explicit checkbox; only with it ticked are this project's own files removed, and only those no other project references in entry data (still-used files stay on disk and are listed on the server console). S3-backed media was and is untouched. No migration.

## 0.22.0 (2026-09-22)

- Schema changes (add, update, remove, restore field) that would break existing entry data are now blocked with a structured reason, both from the admin form and MCP/REST tools (`add_field`, `update_field`, `restore_field`), unless `force: true` is passed. Forced changes are logged to the server console for later audit.
- Removing a field now archives it instead of deleting it. Archived fields show on the collection page and can be restored (with the same impact check) via the admin UI or the new `restore_field` MCP/REST tool.
- New `check_schema_health` MCP/REST tool: scans every field in every collection against live entry data and reports drift, whether from a forced schema change or data edited outside validation.
- `content_version` (and therefore the API `ETag`) now bumps on every schema field change, not just content edits, so polling consumers notice schema drift.
- New logo: the admin sidebar shows the mark next to the name (still visible in the collapsed rail), and the default favicon is the mark, switching light and dark with the browser scheme. Projects with their own icon keep it.

## 0.21.1 (2026-09-21)

- Fix: a counter field's name in written entry data (MCP create, update, batch, import, admin form) was stored and served in the public entry payload. Counter keys are now dropped on every write. Docs: `changed` is only returned for public votes.

## 0.21.0 (2026-09-21)

- Fix: counter votes and counter reads no longer see scheduled (future-dated) entries. Before, a keyless caller could vote on one or tell it existed from a 200 versus 404; now it is a 404 until go-live, like the content API.
- API keys page: the static endpoint table is replaced by an explorer generated from the project's OpenAPI spec (methods, params, headers, scope, rate limits) with a built-in request runner. Paste a key, fill the fields, send real requests and see status, headers and body. The Needs column shows the key scope each endpoint requires (Public, Read or Write). Page reordered: keys, connection strip with rate limit, endpoints and runner, then the REST and MCP reference collapsed. MCP access is now an on/off switch per key, the spec link reads "Export API spec" with an icon, and a Rate limits card lists what each limit covers (per-key writes, tool calls and MCP; per-IP votes; unlimited reads). Both limits are editable, and new projects start with both off (0 = off). Existing projects keep their current limits (60/min per key, 120/min per IP for votes unless changed).
- OpenAPI 3.1 spec per project, generated on first request (nothing at startup) and cached: `GET /api/v1/<project>/openapi.json` with any key, or a download link on the API keys page. Covers content, counters, schema, export/import, media, `/mcp`, and one `/call/<tool>` path per MCP tool built from the same registry, so it cannot drift. Lists request and response headers and where each rate limit applies (per-key limit on writes, tool calls and MCP; per-IP limit on public votes; reads are not limited). Import into Postman, Insomnia, Hoppscotch or Swagger UI as a playground.
- Counter field forms now explain how counters behave (not in the entry payload, votes never touch caches, one vote per visitor per 24h, totals settle in about 5 seconds).

## 0.20.0 (2026-09-20)

- New `counter` field type: up/down votes per entry, for likes, ratings and polls. Choose access when adding the field: public (default, no API key, one vote per visitor, per-IP rate limit, CORS open) or private (write-scope key, optional `by` step up to 1000). Vote with `POST /api/v1/<project>/<collection>/<entry>/counters/<field>?dir=up|down`. Read with `GET .../<entry>/counters` or `GET .../<collection>/counters?slugs=a,b` (max 100); private counters are only returned to callers with a key. Counts never appear in the entry payload, so voting does not change ETags, revisions, `updated_at` or webhooks. New migration `006_counters.sql` (per-project, applies on next open).
- Totals live in memory and are flushed to the `counters` table every 5 seconds in one transaction, and on idle close and clean shutdown. A hard crash loses at most 5 seconds of votes. Voter dedupe is a compact in-memory map (salted hash of project, IP, user agent, entry and field; 24 hour TTL, 200k cap, about 18 MB full). Nothing identifying is stored and a restart forgets voters. Behind a proxy set `TRUST_PROXY=1` so the visitor IP is read from `X-Forwarded-For`.
- Fix: the rate limiter sweep of idle buckets ran on every call once the map passed 10,000 callers, which slowed traffic from many distinct IPs about 3x. It now runs at most every 30 seconds.
- New bench phases on a production-like "misc" collection (every field type plus counters): read only, read and write mix, write only (votes, edits), hot single entry, repeat voters, private bumps. `bench/run.sh` sets `TRUST_PROXY=1`.

## 0.19.1 (2026-09-20)

- List reads are much faster. The serialized JSON body of `GET /api/v1/<project>/<collection>` and its gzip are kept in memory and reused until any write can change the output (a publish, a scheduled go-live, or any edit to entries, collections or project meta drops the cache, so it never serves stale data). Node, 1 CPU, scale 5: short list 2.1k to 4.4k req/s, long list 430 to 3.4k req/s. Single-entry and 304 reads are unchanged.
- The per-key rate limiter map drops buckets idle for a minute once it passes 10,000, so it no longer grows with every distinct caller.
- `bench/run.sh` no longer aborts on an unset `BENCH_ARGS`. New `bench/counter-lab.mjs` compares counter-field designs (not shipped in the package).

## 0.19.0 (2026-09-20)

- Scheduled publishing. Publish an entry with a future date (admin "Publish at" field, UTC, or `publish_entry` with `at`) and it stays hidden from `/api/v1` and the MCP read tools until that time. No timer, no new status, no migration: the read path gates on `published_at <= now`, and the API ETag folds in the count of still-scheduled entries so a cached list refreshes the moment one goes live. `updated_since` also matches entries whose go-live date passed the cursor. Republishing a scheduled entry keeps its date. Admin shows a "scheduled" badge and a "Goes live" line, times display in the viewer's timezone, and the Publish at field takes local time (converted to UTC on submit). New `list_scheduled` MCP tool (write scope, also reachable at `/call/list_scheduled`) lists pending go-lives; `get_entry` with `draft: true` reports `status: "scheduled"`. Note: the `entry.publish` webhook fires when you schedule, not at go-live. The API ETag is now an opaque HMAC, not `v<n>`: clients that echo it are unaffected. Project exports carry `published_at` so restore and import keep a future go-live hidden. An invalid `publish_at` in the admin form returns a 400 page.
- API read path is faster. Prepared statements are now memoized per database handle instead of re-prepared on every query, `last_used_at` on API keys is written at most once a minute instead of on every read, and the collection id and scheduled-entry count are cached per content version. Against the v0.18.5 baseline (node, 1 CPU): single reads +15% to +16%, 304 revalidation +15%, 20-way concurrent reads +43%.

## 0.18.5 (2026-09-19)

- README rewritten for npm consumers: features overview up top, all env vars in one table, admin UI section, clearer auth docs (OAuth and passkeys never create new users), removed dead links to private repo. Homepage now points to npm page.

## 0.18.4 (2026-09-17)

- The launcher now exits with a clear message when the configured PORT is already in use, instead of crashing with a raw EADDRINUSE stack trace. It names the busy port and shows how to pick another (`PORT=3423 npx boring-cms`, or set PORT in the home `.env`). It never silently binds a different port: behind a reverse proxy pointed at a fixed port, a surprise port would be a silent outage. Same handling in the `node server.ts` checkout path. No perf impact (startup path only, verified against the v0.18.3 benchmark). README gains a Production section (VPS deploy, pm2, when to set TRUST_PROXY, media storage, backup).

## 0.18.3 (2026-09-17)

- Clean startup output. The launcher prints a compact banner (version, startup time, admin URL, data directory) and suppresses the node:sqlite ExperimentalWarning, which was pure noise on every start. The first-boot .env message is one line instead of two. No behavior change.

## 0.18.2 (2026-09-17)

- First npm release: `npx boring-cms` (or `pnpm dlx` / `bunx`) downloads the package and starts the server, no clone or install step. The tarball ships type-stripped `.js` built at publish time via a `prepack` tsc pass, because Node refuses native type stripping for files under `node_modules`; the repo itself still runs raw `.ts` with no build step. The launcher keeps `.env` and `data/` in one stable per-machine home, `~/.boring-cms` (override with `BORING_CMS_HOME`), instead of the package directory (which for npx is an ephemeral cache that would silently eat the generated SECRET_KEY), so repeated npx runs from any directory find the same instance. `createApp` accepts a `baseDir` override for this; running `node server.ts` from a checkout behaves exactly as before. A generated first-boot `.env` is now the full commented `.env.example` template with SECRET_KEY filled in, so every knob (PORT, FORCE_PASSWORD_RESET, TRUST_PROXY) is visible without hunting for docs. npm metadata (repository, keywords) added. `PUBLISHING.md` documents the release flow (repo only: the tarball ships runtime files, nothing else) and `pnpm verify:pack` gates every publish: it builds the real tarball, installs and boots it in a temp directory, then runs the smoke suite and the full benchmark against the packaged server. Note: 0.18.1 on npm was unusable via npx (the type-stripping restriction above) and is unpublished.

## 0.18.1 (2026-09-14)

- `update_entry` and `batch_create_entries` accept `preserve_timestamps: true` to skip the `updated_at` bump on update and keep the existing `published_at` on republish. First-time publish still stamps `published_at` normally. Useful for cosmetic bulk edits (e.g. em-dash cleanup) that should not move sitemap lastmod or trigger incremental-pull re-fetches.

## 0.18.0 (2026-09-12)

- Every MCP tool is now callable over plain REST, so the two write surfaces can no longer drift apart. A new generic endpoint `POST /api/v1/<project>/call/<tool>` dispatches to the exact same tool registry the `/mcp` endpoint serves, with the tool's arguments as a JSON body and a Bearer key for auth (write tools need a write-scope key). This closes a real parity gap: entry-body writes (`create_entry`, `batch_create_entries`, `update_entry`, `publish_entry`, `unpublish_entry`, `delete_entry`) and the schema-editing tools previously existed only on MCP, so a headless client (a CI publisher, a script) that could not speak JSON-RPC, or whose key had API access but not the separate MCP-access grant, had no way to create or update article bodies at all. It can now run the full write lifecycle over REST with an ordinary API key. Because both transports resolve tool names through one shared `callTool` over one `TOOLS` registry, a tool added in the future is reachable on both automatically; a smoke test asserts every registered tool is reachable over REST (a 404 there is a drift regression). The MCP endpoint behaves exactly as before. Error shape on the REST route: unknown tool 404, wrong scope 403, tool-level failure (bad arguments, missing collection) 422. No new migration.

- Performance: `bulk_rewrite_refs` now rewrites in a single pass over the entries, independent of how many URL pairs are in the map. v0.17.0 ran one full-table scan per pair (a substring match cannot use an index), so a large map meant hundreds or thousands of whole-table scans and a gateway timeout on a large dataset (a map of 2216 pairs timed out; a single pair already took ~55s). The pass now scans each entry once with a combined literal matcher and writes changed rows by primary key. Behavior is unchanged: same exact-URL swap, same no-op on `updated_at`/`published_at`, same single `content_version` bump, same `dry_run` match counts, same `ref_rewrites` audit. No new migration.

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

Product named **Boring CMS** (cookie/settings crypto salts keep the earlier internal name `yncms` on purpose so existing sessions and encrypted settings survive). Version now shows in the admin sidebar.

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
