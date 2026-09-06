# Stage 4: WordPress migration

**Goal**

Import a WordPress WXR export into a project: posts, pages, categories, tags, authors, media, redirect map. This stage is the reason the CMS exists; fidelity beats speed.

**Decisions**

- Input is a WXR XML file uploaded in the admin (reuses the stage 3 multipart parser). Parsed with a small hand-rolled streaming XML pull parser (WXR is flat and predictable, no need for a full XML lib).
- HTML to markdown conversion runs client-side only per the standing rule? No: import is a one-time admin action, and the rule about "no server logics" was about the editing round-trip. Decision: the importer stores the ORIGINAL HTML in a side field (`_wp_html`) and a server-converted markdown body from a minimal converter covering the WP subset (p, headings, lists, links, img, blockquote, pre/code, strong/em). Anything the converter cannot handle stays as inline HTML in the markdown (markdown allows it), flagged in the import report for eyeball diffing.
- Target mapping: posts and pages become entries in `posts` / `pages` collections (created if missing, with body markdown field plus `_wp_html`, `excerpt`, `categories`, `tags`, `author`, `original_url` fields). Categories/tags stored as comma-joined text v1, taxonomy tables later only if needed.
- Media: `<img>` URLs pointing at the old wp-content are downloaded into the stage 3 media backend and rewritten in the body. Failures listed in the report, never fatal.
- Redirect map: importer emits `redirects.json` (old path to new `/collection/slug`) downloadable from the report page, ready to paste into Netlify `_redirects` or nginx map.
- Import runs in-process but chunked (N items per tick with setImmediate) so the server stays responsive; progress kept in a `jobs` row and polled by the admin page with a meta refresh (no websockets).
- Idempotent: entries keyed by `original_url`; re-running an import updates instead of duplicating.

**Checklist**

- [ ] Streaming WXR pull parser (items, terms, authors, attachments).
- [ ] Minimal HTML-to-markdown converter for the WP subset with an "unconverted tags" report.
- [ ] migrations/project/003_jobs.sql; lib/importer.ts (chunked run, progress, idempotent upsert by original_url).
- [ ] Media pull-through to the storage backend with URL rewriting.
- [ ] Redirect map generation + download.
- [ ] Admin UI: upload WXR, progress page (meta refresh), final report (counts, failures, unconverted tags).
- [ ] Smoke: import a small fixture WXR, assert entries, media rewrite, redirect map, re-import idempotency.

**Verification**

- pnpm smoke green with the WXR fixture.
- Manual: import a real export from one of Amit's WP sites, diff `_wp_html` against rendered markdown for the top 10 posts.
