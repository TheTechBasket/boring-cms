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
`If-None-Match` to get cheap `304`s until the next publish. The API keys
page in the admin documents every endpoint with live URLs for the
project's collections.

## Media

Each project has a media library (sidebar: Media). Files upload to local
disk (`data/media/<project>/`) by default. For buckets, add a shared
storage once under Global settings (endpoint, bucket, keys, region,
public URL; stored encrypted as `storage_<name>`), then select it on any
project's settings page. Multiple storages can coexist and each project
picks its own. The legacy per-project settings (`media_backend=s3`,
`s3_endpoint`, `s3_bucket`, `s3_key`, `s3_secret`, `s3_region`,
`s3_public_url`) still work. All S3-compatible backends (R2, MinIO, S3)
go through the same hand-rolled SigV4 client. Upload limit is 50 MB.

Credential scope: object-level read and write on that one bucket is all
the CMS needs, never an account or admin credential. On R2 create an
API token with "Object Read & Write" scoped to the bucket; on AWS or
MinIO limit the key to `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`
and `s3:ListBucket` on the bucket (list powers Sync storage, delete
powers media removal). Saving a storage tests it first: a probe object is
written, listed and deleted, and any failure is reported with nothing
saved ("Save without testing" skips the probe).

Switching a project's storage never breaks existing files: rows uploaded
under the previous storage keep serving from where they actually live
(badged "old storage" on the media page). "Migrate media to current
storage" copies them over (existing destination objects are never
overwritten), rewrites every entry to the new URLs, and leaves the old
copies untouched, so the old bucket can be deleted once migration is
clean. For S3 sources the copy reads through the storage's public URL.
Migrated rows remember where the old copy lives; "Delete old copies now"
on the media page checks each object still exists, deletes it (variants
included) and reports deleted, already gone, skipped and failed counts.
Skipped rows (no credentials for the old storage) stay retryable.

Local files are served at `/media/<project>/<key>` with immutable
caching; keys are content-hash prefixed. The project slug is permanent
(rename only changes the display name), so these links never break. When
a storage has a public URL (custom domain), every URL the CMS hands out
(Copy MD, image picker, in-editor uploads) uses that domain directly and
never depends on the CMS host or the project slug; bucket keys are flat,
with no project prefix.

Files can be grouped with a free-text group ("featured", "logos",
"temp"...). The media page and the image-field picker are searchable by
filename and group, and the media page can filter by group. The image
field in the entry editor can also upload a new image straight from its
Browse popover.

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

## Auth

Email + password is the fallback; two extras layer on top, both ending
in the same signed session cookie:

- Passkeys: add one from Account in the sidebar; the login page then
  shows "Use a passkey". WebAuthn verification is hand-rolled with
  node:crypto (ES256/RS256, attestation ignored, counter checked for
  clone detection).
- Google: set `google_client_id` and `google_client_secret` in Global
  settings (encrypted at rest) and "Continue with Google" appears.
  Standard code flow with PKCE over plain fetch. Only the admin's email
  may log in; any other Google account gets a clear error. The OAuth
  redirect URI to register is `https://<host>/auth/google/callback`.

Once a passkey or Google is set, password login can be turned off from
Account (kills the brute-force surface). The switch is self-healing: if
both alternatives disappear, password login re-enables itself, and
`FORCE_PASSWORD_RESET=1` always allows it as a break-glass path.

Behind a TLS-terminating proxy set `TRUST_PROXY=1`: `x-forwarded-proto`
is honored and session cookies become `Secure`.

## MCP

Each project is an MCP server at `POST /mcp/<project>` (Streamable HTTP,
plain JSON responses), authenticated with the same Bearer API keys as
the REST API. Keys have a scope: `read` (default) exposes
`list_collections`, `list_entries`, `get_entry`; `write` adds
`create_entry`, `update_entry`, `publish_entry`, `unpublish_entry`.
Agent edits go through the normal content layer, so every change is a
revertable revision. Requests are rate limited per key (60/min, `429`
with `Retry-After`).

The API keys page shows a ready-to-paste Claude Code `.mcp.json` using
the instance's own URL, and creating a key shows the complete config
with the key filled in:

```json
{
  "mcpServers": {
    "my-site": {
      "type": "http",
      "url": "https://cms.example.com/mcp/my-site",
      "headers": { "Authorization": "Bearer yn_..." }
    }
  }
}
```

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
