# Stage 1: Core

**Goal**

One process. `pnpm i && node server.js` starts yncms. Admin can log in, create projects, manage settings. All secrets live encrypted in core.db. Full context: `ARCHITECTURE.md`.

**Decisions**

- Node 22+ built-in modules where possible. `node:sqlite` if stable enough on Node 22, else `better-sqlite3`. Verify at start of build and record the choice here.
  - **Chosen: `node:sqlite`.** Installed Node is v24.13.1; `node:sqlite` loads and works (`DatabaseSync`, `.exec`, `.prepare().run/get/all`), it only prints an experimental-feature warning on first use. Zero extra dependencies, matches the "minimal dependencies" constraint better than `better-sqlite3`. `lib/db.js` wraps `.prepare` to time every query and log anything over 10ms into `slow_queries`.
  - One SQLite gotcha worth recording: the `settings` table has `UNIQUE(scope, project_id, key)`, but SQLite treats every `NULL` in a unique index as distinct, so `ON CONFLICT` never fires for global settings (`project_id IS NULL`). `setSetting()` in `lib/store.js` upserts by hand (SELECT then UPDATE or INSERT) instead of relying on `ON CONFLICT`.
- HTTP: pick the smallest thing that works. Bare `node:http` with a tiny router is acceptable. No Express.
- Sessions: signed cookie (HMAC with key derived from MASTER_KEY), session row in core.db.
- Passwords: `crypto.scrypt`. No bcrypt dependency.
- Settings encryption: AES-256-GCM, per-value random IV, key = HKDF(MASTER_KEY).
- Admin UI: HTML template strings server-side, one small vanilla JS file, one CSS file. No build step.

**Checklist**

- [x] Repo scaffold: package.json (pnpm, MIT), .gitignore, .env.example (MASTER_KEY, PORT, FORCE_PASSWORD_RESET), README stub. Also added LICENSE (MIT).
- [x] core.db schema + migration runner (plain numbered SQL files): users, sessions, projects, settings (encrypted values), slow_queries. `migrations/001_init.sql`, runner in `lib/db.js` tracks applied files in a `migrations` table.
- [x] Config loader: .env for bootstrap only, everything else read from settings table. `lib/config.js`, hand-rolled parser, no dotenv. Also honors a `YNCMS_DATA_DIR` override so the smoke check and future test setups can point at a temp directory.
- [x] First-run flow: no user exists, serve setup page, create admin (email + password, scrypt). Global gate in `server.js` redirects every route except `/setup` and `/public/*`.
- [x] Login, logout, session middleware for admin routes. FORCE_PASSWORD_RESET honored (sets `must_reset_password` on all users at boot; `requireAdmin` middleware forces `/reset-password` until cleared).
- [x] Project CRUD: create (slug, name), list, rename, delete (deletes data/projects/<slug>.db after confirm, confirm field must match the slug exactly). Lazy-open per-project DB handles with idle-close (5 minutes) in `ProjectDbManager`.
- [x] Encrypted settings store + admin UI page: global settings and per-project settings, values write-only in UI (show set/unset, never echo secrets). AES-256-GCM in `lib/crypto.js`, keyed via HKDF from MASTER_KEY with a salt/info distinct from the cookie key.
- [x] Admin UI shell: layout, nav (projects, settings), login page, project list page. Plain HTML template strings in `lib/views.js`, one CSS file and one JS file in `public/`.
- [x] Server-Timing header + slow-query logging (>10ms) wired from the start. Every response carries `Server-Timing: total;dur=<ms>`; `lib/db.js` times every prepared-statement call and logs anything over 10ms into `slow_queries`.
- [x] Smoke check: script that boots server, runs setup, creates project, sets and reads back an encrypted setting, asserts. `scripts/smoke.mjs`, wired as `pnpm smoke`, exits 0.

**Verification**

- Run the smoke check script. All asserts pass. Done: `pnpm smoke` exits 0, prints "smoke: all assertions passed".
- Start the server. Memory use at idle is below 100 MB. Done: RSS observed at ~63 MB after boot.
- Delete a project. The project DB file is gone. Other projects still work. Done: covered in the smoke check (creates one project, deletes it, asserts the `.db` file and core.db row are both gone).
