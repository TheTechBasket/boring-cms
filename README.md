# yncms

Open-source headless CMS. One deploy, many projects. Light when idle, fast
under load. See `ARCHITECTURE.md` for the full design and `plans/` for the
build stages.

Built so far: one process, SQLite, email+password auth, project CRUD,
encrypted settings, custom collections, markdown entries with smart
revisions, publish workflow, and a read-only JSON API with API keys.
No runtime dependencies, no build step, no framework. TypeScript running
natively on Node 24 (type stripping).

## Quick start

```bash
pnpm i
node server.ts
```

On first boot with no `.env`, the server generates one with a random
`SECRET_KEY` and `PORT=3000`. Open `http://localhost:3000`. With no admin
user yet, every route redirects to `/setup` to create the single admin
account. After that, log in at `/login` and manage everything under
`/admin`.

`SECRET_KEY` signs session cookies and encrypts stored settings. Keep it
stable: changing it invalidates sessions and makes encrypted settings
unreadable. `MASTER_KEY` is accepted as a legacy alias.

`pnpm css` is only needed after editing styles or views: it rebuilds
`public/admin.css` from `styles/admin.src.css`, and the built file is
committed so deploys never run a build.

## Content model

Each project has its own SQLite file. Inside a project you create
collections, each with custom fields (text, markdown, number, boolean,
date, json). Entries have no built-in fields: their id is a UUID, and
lists label each entry with its first field's value. Collection slugs
are auto-generated from names. Edits store backward
field-level deltas as revisions (last 20 kept, 90-day cap) with atomic
revert. Publishing materializes a snapshot served by the API, so reads
never touch draft data.

## Content API

Create an API key under Project, then:

```bash
curl -H "Authorization: Bearer yn_..." \
  http://localhost:3000/api/v1/<project>/<collection>        # list (limit/offset)
curl -H "Authorization: Bearer yn_..." \
  http://localhost:3000/api/v1/<project>/<collection>/<slug> # single entry
```

Responses carry an `ETag` tied to the project's content version; send
`If-None-Match` to get cheap `304`s until the next publish.

## Media

Each project has a media library (sidebar: Media). Files upload to local
disk (`data/media/<project>/`) by default; set the encrypted project
settings `media_backend=s3`, `s3_endpoint`, `s3_bucket`, `s3_key`,
`s3_secret` (optionally `s3_region`, `s3_public_url`) to store in any
S3-compatible bucket (R2, MinIO, S3) via a hand-rolled SigV4 client.
Files are served at `/media/<project>/<key>` with immutable caching;
keys are content-hash prefixed. If `s3_public_url` is set, the serve
route redirects there instead of proxying. Install `sharp` (optional)
to pre-generate thumb (320px) and medium (1024px) variants at upload
time; without it uploads still work. Upload limit is 50 MB.

## Smoke check

```bash
pnpm smoke
```

Boots the server on a random port with a temp data directory and walks the
whole flow: setup, login, project, encrypted setting, collection, field,
entry, revision delta, publish, API key, authorized API read, 304, revert,
delete. Asserts each step.

## Layout

- `server.ts`: entry point, HTTP server and all routes.
- `lib/`: config loader, database layer, crypto, sessions, router, content,
  HTML views.
- `migrations/`: numbered SQL for `core.db`; `migrations/project/` for each
  project DB.
- `public/`: static admin CSS and JS, served as-is.
- `data/`: `core.db` and `data/projects/<slug>.db`. Created on first run, not
  committed.
