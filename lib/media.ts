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

export async function createMedia(db, backend, { filename, mime, data }) {
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 8);
  const extMatch = filename.match(/\.([A-Za-z0-9]+)$/);
  const ext = (extMatch ? extMatch[1] : 'bin').toLowerCase();
  const stem = slugify(filename.replace(/\.[^.]*$/, '')) || 'file';
  const key = `${hash}-${stem}.${ext}`;

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
      for (const [name, w] of VARIANT_WIDTHS) {
        if (!width || width <= w) continue;
        const vkey = `${hash}-${stem}.${name}.${ext}`;
        await backend.put(vkey, await sharp(data).resize({ width: w }).toBuffer(), mime);
        variants[name] = vkey;
      }
    } catch {
      // not a decodable image; keep the original only
    }
  }

  db.prepare('INSERT INTO media (filename, key, mime, size, width, height, variants) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(filename, key, mime, data.length, width, height, JSON.stringify(variants));
  return getMediaByKey(db, key);
}

export async function deleteMedia(db, backend, id) {
  const media = getMedia(db, id);
  if (!media) return;
  for (const key of [media.key, ...Object.values(media.variants)]) {
    await backend.remove(key);
  }
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
}
