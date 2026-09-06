# Stage 3: Media

**Goal**

Upload, store, and serve media per project. Local disk by default, S3-compatible backend switchable from project settings. Image variants resized ahead of time so the serve path is a plain file read.

**Decisions**

- Storage is a small backend interface: `put(key, stream)`, `getStream(key)`, `delete(key)`, `url(key)`. Two implementations: local (`data/media/<project>/`) and S3-compatible (hand-rolled SigV4 over fetch, zero deps, works with R2/MinIO/S3). Backend and credentials come from encrypted project settings (`media_backend`, `s3_endpoint`, `s3_bucket`, `s3_key`, `s3_secret`), never `.env`.
- `sharp` is the one heavy optional dependency. If it is not installed, uploads still work, only resize is skipped. Detect with a try-import at boot.
- Variants (thumb 320, medium 1024, original) are generated at upload time, not on request. Materialize ahead of time, same principle as `published_data`.
- `media` table per project DB: id, filename, key, mime, size, width/height, variants JSON, created_at. Filenames slugified with the usual unique-suffix helper.
- Serve route `GET /media/:project/:key` streams from the backend with long-lived `Cache-Control: public, max-age=31536000, immutable` (keys are content-addressed by hash prefix, so immutable is safe). For S3 backends, redirect to the public URL instead of proxying when the bucket is public.
- Admin UI: media library page per project (grid of thumbs, upload form, delete), and an "insert" flow on markdown fields that copies the markdown image snippet to paste.
- Upload limit 50 MB, multipart parsed by hand (single-file fields only, no busboy).

**Checklist**

- [ ] Multipart form parser in lib (single file + fields, streaming to temp file).
- [ ] Storage backend interface + local implementation.
- [ ] S3 SigV4 client (PUT/GET/DELETE) + backend implementation; settings read from encrypted project settings.
- [ ] migrations/project/002_media.sql; lib/media.ts (create, list, delete, variant generation via optional sharp).
- [ ] Serve route with immutable caching; S3 public-URL redirect path.
- [ ] Media library UI: grid, upload, delete (behind confirm), copy-markdown-snippet.
- [ ] Smoke: upload a file to local backend, fetch it back, delete it.
- [ ] pnpm css rebuild, README media section.

**Verification**

- pnpm smoke green.
- Manual: upload an image with and without sharp installed; switch a project to R2 credentials and upload again.
