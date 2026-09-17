# Boring CMS

Open-source headless CMS. One deploy, many projects. One process, SQLite,
zero runtime dependencies, no build step, no framework. TypeScript running
natively on Node 24. Full design in `ARCHITECTURE.md`.

## Quick start

```bash
npx boring-cms
```

Data and a generated `.env` (with a random `SECRET_KEY`) live in
`~/.boring-cms` (override with `BORING_CMS_HOME`). Open
`http://localhost:3000`, create the single admin account at `/setup`,
manage everything under `/admin`.

From a checkout:

```bash
pnpm i
node server.ts
```

Keep `SECRET_KEY` stable: changing it invalidates sessions and makes
encrypted settings unreadable.

## Production

One Node process plus a SQLite file, so it runs on any small always-on
box (a VPS). Node 24+ is the only requirement.

1. Install a pinned version: `npm i -g boring-cms`.

2. Set a persistent home (not the throwaway `npx` cache). It holds
   `.env`, the databases, and local media, so back it up.

   ```bash
   export BORING_CMS_HOME=/home/boring/.boring-cms
   ```

3. Write its `.env`:

   ```ini
   SECRET_KEY=<node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))">
   PORT=3000
   TRUST_PROXY=1
   ```

   Generate `SECRET_KEY` once and keep it: rotating it logs everyone out
   and makes encrypted settings unreadable. Set `TRUST_PROXY=1` only when
   a reverse proxy terminates TLS in front of the app (the normal public
   setup): it trusts `X-Forwarded-*`, marks cookies `Secure`, and is
   required for passkeys. Leave it `0` if the app faces clients directly.

4. Keep it running with pm2:

   ```bash
   pm2 start "$(which boring-cms)" --name cms
   pm2 save && pm2 startup   # restart on reboot
   ```

5. Put a TLS reverse proxy (nginx, Caddy) in front, routing
   `cms.example.com` to `127.0.0.1:3000` and forwarding `X-Forwarded-*`.

6. Open `https://cms.example.com/setup`, create the admin, add per-project
   API keys.

**Media**: local disk works but pins data to one box. For public sites,
add S3-compatible storage (Cloudflare R2, MinIO, S3) under Global settings.

**Backup**: snapshot `$BORING_CMS_HOME`, or cron each project's
`GET /api/v1/<project>/export` (restore via `/import`).

## Content model

Each project is its own SQLite file. Collections have custom fields
(text, markdown, number, boolean, date, json, image, relation). Edits
store field-level revision deltas with atomic revert. Publishing
materializes a snapshot served by the API; editing a published entry
only changes its draft until you republish.

## Content API

Create an API key under Project, then:

```bash
curl -H "Authorization: Bearer yn_..." \
  http://localhost:3000/api/v1/<project>/<collection>        # list (limit/offset/updated_since)
curl -H "Authorization: Bearer yn_..." \
  http://localhost:3000/api/v1/<project>/<collection>/<slug> # single entry
```

Responses carry an `ETag` tied to the project's content version; send
`If-None-Match` for cheap `304`s until the next publish. The API keys
page in the admin documents every endpoint with live URLs.

Every MCP tool is also callable over REST:
`POST /api/v1/<project>/call/<tool>` with the tool's arguments as JSON
body (write tools need a write-scope key).

Media upload with a write-scope key (multipart, field `file`; optional
`path`, `storage`, `variants=1`):

```bash
curl -H "Authorization: Bearer yn_..." \
  -F file=@photo.jpg -F path=uploads/2026/09 \
  http://localhost:3000/api/v1/<project>/media
# -> { "id": 12, "key": "...", "url": "https://cdn.example.com/..." }
```

### Backup and restore

```bash
# Snapshot: schema + all entries, one file (read-scope key).
curl -H "Authorization: Bearer yn_..." \
  http://localhost:3000/api/v1/<project>/export > backup.json

# Restore: idempotent upsert by slug (write-scope key).
curl -X POST -H "Authorization: Bearer yn_..." \
  -H "Content-Type: application/json" --data-binary @backup.json \
  http://localhost:3000/api/v1/<project>/import
```

Restore applies the schema, then creates or updates each entry,
preserving publish state. Entries absent from the dump are left alone;
`?delete_missing=1` drops collections absent from the dump. 64 MB cap.

## Webhooks

Per-project webhook URL and optional HMAC secret under Project settings.
Fires on `entry.publish`, `entry.unpublish`, `entry.delete` (of published
entries) with a JSON payload (`event`, `project`, `collection`, `slug`,
`at`) and, with a secret, an `X-Boring-Signature: sha256=<hex>` header.
10s timeout, 2 in-process retries, never blocks admin or MCP requests.

## Media

Per-project media library. Local disk by default
(`data/media/<project>/`, served at `/media/<project>/<key>` with
immutable caching). For buckets, add a shared storage under Global
settings (any S3-compatible backend: R2, MinIO, S3); each project picks
its own. Saving a storage tests it with a probe object first. Scope
credentials to object read/write on the one bucket.

Uploads go browser-to-bucket via presigned PUT (bucket needs a CORS PUT
rule; falls back to server-side). Optional resized variants (320px,
1024px) per upload with `sharp` installed, strictly opt-in. Switching
storage never breaks old files; "Migrate media to current storage"
copies them, rewrites entry URLs, and can delete old copies afterwards.
"Sync storage" reconciles the bucket against the library. 50 MB limit.

## Export and import

Per-project Transfer page: export whole project, schema, or one
collection as JSON; import JSON or CSV with field mapping and a dry-run
report. Pick a unique field so re-imports update instead of duplicate.
Imports go through the normal content layer, so revisions and publish
state stay intact.

Schema-as-code: `GET /admin/projects/<slug>/schema.json` exports the
schema; paste the same shape into "Apply schema" to sync. Nothing is
deleted unless the destructive checkbox is on.

## Auth

Email + password, plus optional passkeys (WebAuthn, added from Account)
and Google OAuth (`google_client_id` / `google_client_secret` in Global
settings; redirect URI `https://<host>/auth/google/callback`). Once a
passkey or Google works, password login can be turned off from Account;
it re-enables itself if both alternatives disappear, and
`FORCE_PASSWORD_RESET=1` is the break-glass path.

Behind a TLS-terminating proxy set `TRUST_PROXY=1` (honors
`x-forwarded-proto`, cookies become `Secure`; required for passkeys in
production).

## MCP

Each project is an MCP server at `POST /mcp/<project>` (Streamable
HTTP), authenticated with the same Bearer API keys. `read` scope:
`list_collections`, `list_entries`, `get_entry`. `write` adds the full
entry lifecycle. Agent edits are normal revertable revisions. Rate
limited per key (60/min, `429` with `Retry-After`). The API keys page
shows a ready-to-paste Claude Code `.mcp.json`:

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

## Development

```bash
pnpm smoke   # boots on a random port, walks the whole flow, asserts each step
pnpm css     # rebuild public/admin.css after editing styles or views
```

- `server.ts`: entry point, HTTP server and all routes.
- `lib/`: config, database, crypto, sessions, router, content, views.
- `migrations/`: numbered SQL for `core.db` and per-project DBs.
- `public/`: static admin CSS and JS.
- `data/`: `core.db` and `data/projects/<slug>.db`, created on first run.
