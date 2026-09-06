# yncms

Open-source headless CMS. One deploy, many projects. Light when idle, fast
under load. See `ARCHITECTURE.md` for the full design and `plans/` for the
build stages.

Stage 1 (this code): one process, SQLite, email+password auth, project CRUD,
encrypted settings, admin UI shell. No build step, no framework.

## Quick start

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# paste the output as MASTER_KEY in .env

pnpm i
node server.js
```

Open `http://localhost:3000`. With no admin user yet, every route redirects
to `/setup` to create the single admin account. After that, log in at
`/login` and manage projects and settings under `/admin`.

`pnpm css` is only needed after editing styles or views: it rebuilds
`public/admin.css` from `styles/admin.src.css`, and the built file is
committed so deploys never run a build.

## Smoke check

```bash
pnpm smoke
```

Boots the server on a random port with a temp data directory, runs setup,
logs in, creates a project, sets and reads back an encrypted setting, deletes
the project, and asserts each step.

## Layout

- `server.js`: entry point, starts the HTTP server.
- `lib/`: config loader, database layer, crypto, sessions, router, HTML views.
- `migrations/`: numbered SQL files applied in order to `core.db`.
- `public/`: static admin CSS and JS, served as-is.
- `data/`: `core.db` and `data/projects/<slug>.db`. Created on first run, not
  committed.
