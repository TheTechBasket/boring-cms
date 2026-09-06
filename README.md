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
route redirects there instead of proxying. Upload limit is 50 MB.

Variants are strictly opt-in: check "Create resized variants" on upload
(needs the optional `sharp` install) to also store 320px and 1024px
copies under `<key>_320.<ext>` / `<key>_1024.<ext>` suffixed keys. The
project setting `media_variants` controls the checkbox default: `on`
pre-checks it, `off` hides it. Nothing is resized unless asked.

With the S3 backend, the browser uploads straight to the bucket via a
presigned PUT (the server never proxies the bytes); the bucket needs a
CORS rule allowing PUT from the admin origin. If direct upload fails
the form falls back to the normal server-side upload. Grid previews use
the free wsrv.nl image proxy when `s3_public_url` is set, so no local
copies or variants are needed for thumbnails.

Each image shows a "where used" count, a live scan of entry content
for the key (no stored relationships). "Sync storage" reconciles the
bucket against the library: files uploaded outside the CMS are adopted
as rows, rows whose object is gone are reported as missing.

## Export and import

Each project has a Transfer page (sidebar). Export the whole project,
the schema only, or one collection as JSON. Import JSON (a yncms export
or any array of flat objects) or CSV with a header row: upload, map each
source field to an existing field, a new field, or skip, review the
dry-run report (row counts, type coercion failures, sample), then
confirm. Pick a unique field to make re-imports update matching entries
instead of duplicating. Imports go through the normal content layer, so
revisions and publish state stay intact.

Schema-as-code: `GET /admin/projects/<slug>/schema.json` exports the
full schema; paste the same shape into "Apply schema" to sync it.
Missing collections are created, changed ones updated, and nothing is
deleted unless the destructive checkbox is on, so a schema file in a
site repo can be the source of truth and re-applying is always safe.

To migrate from WordPress, convert the WXR file to JSON with an external
script and import it here; the CMS has no WordPress-specific code.

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
