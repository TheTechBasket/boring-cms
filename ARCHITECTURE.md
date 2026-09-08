# Boring CMS Architecture (repo: yncms)

Open-source headless CMS. One deploy, many projects. Light when idle, fast under load. Target: migrate Amit's WordPress sites first, public product second.

## Locked decisions

- **Runtime**: Node 22+, pnpm. No build step for the server. `node server.js` is the deploy.
- **Database**: SQLite only for v1. `core.db` for users, projects, encrypted settings. One DB file per project at `data/projects/<slug>.db`. WAL mode, `synchronous=NORMAL`. Per-project file means per-project lock scope: heavy writes in one project never stall reads in another.
- **No third-party services**. No Redis, no external queue, no SaaS. Optional S3-compatible media backend (R2, MinIO, S3) is the one outward dependency, off by default, signed with a small in-repo SigV4 implementation, not the AWS SDK.
- **Secrets**: everything managed from the admin UI, stored in `core.db`, encrypted AES-256-GCM with a key derived from `MASTER_KEY` in `.env`. The `.env` file holds only: `MASTER_KEY`, `PORT`, `FORCE_PASSWORD_RESET` and similar bootstrap flags.
- **Content format**: markdown is the stored source of truth. HTML-to-markdown and markdown-to-HTML conversion happens client-side in the editor (no server conversion logic). Publish pipeline renders markdown to HTML once and stores both.
- **Schema model**: custom collections builder. Collections and fields defined per project from the UI (text, richtext/markdown, media, relation, date, boolean, number, select).
- **API**: REST JSON per project with API keys, v1. Delivery layer built as a seam so webhooks, GraphQL, or other transports plug in later without touching the core.
- **Admin UI**: server-rendered HTML plus light vanilla JS. No SPA, no build step. Plain markdown textarea with client-side preview for v1.
- **Auth**: email plus password v1, single admin user. Passkey (WebAuthn) and Google OAuth staged later, OAuth credentials entered from the UI.
- **Upgrades**: `git pull && pnpm i && restart`. No self-update.
- **License**: MIT.

## Performance design (built in from day one)

1. **Publish-time materialization**. The edit path may be slow; the read path must be dumb. On publish: render markdown to HTML once, denormalize resolved relations, author, and taxonomy slugs into a `published_entries` table so the public API reads one row with no joins, and precompute common sorted lists (latest N per collection, per tag).
2. **SQLite discipline**. Prepared statements cached per connection. Covering indexes designed per query. Lazy-open connection per project DB, idle-close after a few minutes, so 50 idle projects cost near zero.
3. **Response cache**. In-memory LRU keyed by URL and params, with a per-project version counter. Publish bumps the counter: whole-project invalidation in O(1), no TTL guessing, never stale. ETag/If-None-Match on top so repeat static-site builds get 304s.
4. **Hot-path isolation**. The public content API is its own tiny router: no sessions, no middleware stack, API-key check from an in-memory map, straight to cache or DB. Admin routes carry the heavy machinery.
5. **Measure from day one**. `Server-Timing` header on every response. Queries slower than 10ms logged to a per-project table and shown in the admin UI.

Deliberately deferred (clear seams left): read replicas, Litestream backups, worker threads for import jobs, cache backend swap.

## Stages

1. **Core**: HTTP server, core.db schema, project CRUD, email+password auth, encrypted settings store, admin UI shell.
2. **Content engine**: collections builder, entries CRUD, drafts and publish pipeline with materialization, per-project REST API with API keys.
3. **Media**: uploads, local disk plus S3-compatible backend, image resize (sharp — the one heavy dependency worth it).
4. **WP migration**: WXR importer — posts, pages, media pull, categories, tags, authors, redirect map. Original HTML kept in a side field next to the converted markdown for eyeball diffing.
5. **Auth extras**: passkey (WebAuthn), Google OAuth with UI-entered credentials.
6. **MCP**: per-project MCP endpoint, API-key scoped.
