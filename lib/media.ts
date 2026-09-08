// Media records + variant generation. sharp is the one optional heavy
// dependency: without it uploads still work, resize is just skipped.

import { createHash } from 'node:crypto';
import { slugify } from './content.ts';

let sharp = null;
try {
  sharp = (await import('sharp' as string)).default;
} catch {
  // optional
}
export const hasSharp = !!sharp;

// Pre-generated at upload time so the serve path is a plain read.
const VARIANT_WIDTHS: [string, number][] = [['thumb', 320], ['medium', 1024]];

export function listMedia(db) {
  return db.prepare('SELECT * FROM media ORDER BY id DESC').all().map(parseMedia);
}

export function getMedia(db, id) {
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  return row ? parseMedia(row) : null;
}

export function getMediaByKey(db, key) {
  const row = db.prepare('SELECT * FROM media WHERE key = ?').get(key);
  return row ? parseMedia(row) : null;
}

// The serve route looks keys up by exact match against original or variant keys.
export function findServableMedia(db, key) {
  const exact = getMediaByKey(db, key);
  if (exact) return { media: exact, key };
  const row = db.prepare("SELECT * FROM media WHERE variants LIKE ?").get(`%${key}%`);
  if (!row) return null;
  const media = parseMedia(row);
  return Object.values(media.variants).includes(key) ? { media, key } : null;
}

function parseMedia(row) {
  return { ...row, variants: JSON.parse(row.variants) };
}

export function mediaKeyFor(hashHex: string, filename: string, prefix = '') {
  const hash = hashHex.slice(0, 8);
  const extMatch = filename.match(/\.([A-Za-z0-9]+)$/);
  const ext = (extMatch ? extMatch[1] : 'bin').toLowerCase();
  const stem = slugify(filename.replace(/\.[^.]*$/, '')) || 'file';
  const flat = `${hash}-${stem}.${ext}`;
  return { key: prefix ? `${prefix}/${flat}` : flat, hash, stem, ext };
}

// A folder prefix a caller may upload under: slash-separated segments of
// safe chars, no dot-only segments (blocks traversal), no leading/trailing
// slash. Returns the prefix or null when invalid.
export function mediaPrefixFrom(raw: string): string | null {
  if (!raw) return '';
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(raw)) return null;
  if (raw.split('/').some((seg) => /^\.+$/.test(seg))) return null;
  return raw;
}

// Variants are strictly opt-in (withVariants), identified by a width suffix
// in the key: <hash>-<stem>_320.ext. Never generated unless asked.
export async function createMedia(db, backend, { filename, mime, data }, { withVariants = false, prefix = '' } = {}) {
  const hashHex = createHash('sha256').update(data).digest('hex');
  const { key, hash, stem, ext } = mediaKeyFor(hashHex, filename, prefix);

  const existing = getMediaByKey(db, key);
  if (existing) return existing; // same content re-uploaded

  await backend.put(key, data, mime);

  let width = null;
  let height = null;
  const variants: Record<string, string> = {};
  if (sharp && mime.startsWith('image/') && mime !== 'image/svg+xml') {
    try {
      const meta = await sharp(data).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      if (withVariants) {
        for (const [name, w] of VARIANT_WIDTHS) {
          if (!width || width <= w) continue;
          const vkey = `${prefix ? `${prefix}/` : ''}${hash}-${stem}_${w}.${ext}`;
          await backend.put(vkey, await sharp(data).resize({ width: w }).toBuffer(), mime);
          variants[name] = vkey;
        }
      }
    } catch {
      // not a decodable image; keep the original only
    }
  }

  db.prepare('INSERT INTO media (filename, key, mime, size, width, height, variants, folder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(filename, key, mime, data.length, width, height, JSON.stringify(variants), '');
  return getMediaByKey(db, key);
}

// Row for a file that already sits in the bucket (presigned browser upload
// or adopted during sync). No bytes pass through the server.
export function registerMedia(db, { filename, key, mime, size, width = null, height = null }) {
  const existing = getMediaByKey(db, key);
  if (existing) return existing;
  db.prepare('INSERT INTO media (filename, key, mime, size, width, height, variants, folder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(filename, key, mime, size, width, height, '{}', '');
  return getMediaByKey(db, key);
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', txt: 'text/plain', json: 'application/json', csv: 'text/csv', zip: 'application/zip',
};

export function guessMime(key: string) {
  const ext = (key.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

// Keys the CMS can own: flat always; nested paths (a/b/c.jpg) only when the
// caller says so (a public base exists, so the app serve route is not needed).
export function adoptableKey(key: string, allowNested: boolean) {
  if (key.split('/').some((seg) => /^\.+$/.test(seg))) return false; // no "." / ".." segments
  if (/^[A-Za-z0-9._-]+$/.test(key)) return true;
  return allowNested && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/.test(key);
}

// Reconcile a backend against the media table. Check-first: without apply it
// only reports what a sync would do (adoptable files, rows whose object is
// gone); with apply it adopts the adoptable files as rows. Variant keys
// (referenced by any row) are left alone.
export async function syncMedia(db, backend, { apply = false, allowNested = false } = {}) {
  const objects = await backend.list();
  const objectKeys = new Set(objects.map((o) => o.key));
  const rows = listMedia(db);
  const known = new Set(rows.flatMap((m) => [m.key, ...Object.values(m.variants)]));
  const report = {
    adoptable: [] as Array<{ key: string; size: number }>,
    adopted: [] as string[],
    missing: [] as string[],
    total: objects.length,
  };
  for (const o of objects) {
    if (known.has(o.key) || !adoptableKey(o.key, allowNested)) continue;
    report.adoptable.push({ key: o.key, size: o.size });
    if (apply) {
      const name = o.key.split('/').pop().replace(/^[0-9a-f]{8}-/, '');
      registerMedia(db, { filename: name, key: o.key, mime: guessMime(o.key), size: o.size });
      report.adopted.push(o.key);
    }
  }
  for (const m of rows) {
    if (!objectKeys.has(m.key)) report.missing.push(m.key);
  }
  return report;
}

// "Where used": plain LIKE scan of entry data for the key, no stored
// relationships. Content search covers linking, per house style.
export function mediaUsage(db, key) {
  return db
    .prepare(
      `SELECT e.slug, c.slug AS collection_slug, c.name AS collection_name, e.data
       FROM entries e JOIN collections c ON c.id = e.collection_id
       WHERE e.data LIKE ? ESCAPE '\\'`,
    )
    .all(`%${key.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
    .map((r) => ({ slug: r.slug, collection: r.collection_slug, collectionName: r.collection_name }));
}

export async function deleteMedia(db, backend, id) {
  const media = getMedia(db, id);
  if (!media) return;
  for (const key of [media.key, ...Object.values(media.variants)]) {
    await backend.remove(key);
  }
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
}
