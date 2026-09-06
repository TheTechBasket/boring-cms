# Stage 1: Core

**Goal**

One process. `pnpm i && node server.js` starts yncms. Admin can log in, create projects, manage settings. All secrets live encrypted in core.db. Full context: `ARCHITECTURE.md`.

**Decisions**

- Node 22+ built-in modules where possible. `node:sqlite` if stable enough on Node 22, else `better-sqlite3`. Verify at start of build and record the choice here.
- HTTP: pick the smallest thing that works. Bare `node:http` with a tiny router is acceptable. No Express.
- Sessions: signed cookie (HMAC with key derived from MASTER_KEY), session row in core.db.
- Passwords: `crypto.scrypt`. No bcrypt dependency.
- Settings encryption: AES-256-GCM, per-value random IV, key = HKDF(MASTER_KEY).
- Admin UI: HTML template strings server-side, one small vanilla JS file, one CSS file. No build step.

**Checklist**

- [ ] Repo scaffold: package.json (pnpm, MIT), .gitignore, .env.example (MASTER_KEY, PORT, FORCE_PASSWORD_RESET), README stub.
- [ ] core.db schema + migration runner (plain numbered SQL files): users, sessions, projects, settings (encrypted values), slow_queries.
- [ ] Config loader: .env for bootstrap only, everything else read from settings table.
- [ ] First-run flow: no user exists, serve setup page, create admin (email + password, scrypt).
- [ ] Login, logout, session middleware for admin routes. FORCE_PASSWORD_RESET honored.
- [ ] Project CRUD: create (slug, name), list, rename, delete (deletes data/projects/<slug>.db after confirm). Lazy-open per-project DB handles with idle-close.
- [ ] Encrypted settings store + admin UI page: global settings and per-project settings, values write-only in UI (show set/unset, never echo secrets).
- [ ] Admin UI shell: layout, nav (projects, settings), login page, project list page.
- [ ] Server-Timing header + slow-query logging (>10ms) wired from the start.
- [ ] Smoke check: script that boots server, runs setup, creates project, sets and reads back an encrypted setting, asserts.

**Verification**

- Run the smoke check script. All asserts pass.
- Start the server. Memory use at idle is below 100 MB.
- Delete a project. The project DB file is gone. Other projects still work.
