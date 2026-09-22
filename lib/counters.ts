// Counter fields: up/down totals per (entry, field), kept in memory and
// flushed to the project's `counters` table on a timer (write-behind), plus a
// compact voter map so a visitor cannot vote twice the same way.
//
// - Totals: memory is authoritative between flushes; one transaction per
//   flush. A hard crash loses up to FLUSH_MS of votes, a clean shutdown none.
// - Voters: key is 48 bits of sha1(salt|project|ip|ua|entry:field), value is
//   minute*2 + isDown. The salt is random per boot, so nothing identifying is
//   stored and a restart forgets voters. Same vote again is a no-op, the
//   opposite vote switches (net change of 2). Capped, oldest evicted first.

import { createHash, randomBytes } from 'node:crypto';

const FLUSH_MS = 5000;
const VOTER_TTL_MIN = 24 * 60;
const VOTER_CAP = 200_000;
const TOTALS_CAP = 100_000;

export function createCounters() {
  const salt = randomBytes(16);
  const voters = new Map<number, number>();
  const totals = new Map<string, { db: any; entryId: number; field: string; up: number; down: number }>();
  const dirty = new Set<string>();

  function total(slug: string, db: any, entryId: number, field: string) {
    const k = `${slug}\0${entryId}\0${field}`;
    let t = totals.get(k);
    if (!t) {
      const r = db.prepare('SELECT up, down FROM counters WHERE entry_id = ? AND field = ?').get(entryId, field);
      totals.set(k, (t = { db, entryId, field, up: r?.up ?? 0, down: r?.down ?? 0 }));
    } else {
      // Handle may have been closed/reopened (idle close) since first cache:
      // rebind so flush() writes through the live handle, not a dead one.
      t.db = db;
    }
    return { k, t };
  }

  // Current totals, for read endpoints.
  function read(slug: string, db: any, entryId: number, field: string) {
    const { t } = total(slug, db, entryId, field);
    return { up: t.up, down: t.down };
  }

  // Applies one vote. Returns the totals after it.
  function vote(slug: string, db: any, entryId: number, field: string, ip: string, ua: string, down: boolean) {
    const { k, t } = total(slug, db, entryId, field);
    const vk = createHash('sha1').update(salt).update(`${slug}|${ip}|${ua}|${entryId}:${field}`).digest().readUIntBE(0, 6);
    const prev = voters.get(vk);
    const min = Math.floor(Date.now() / 60000);
    const d = down ? 1 : 0;
    const fresh = prev !== undefined && min - (prev >> 1) < VOTER_TTL_MIN;
    if (fresh && (prev & 1) === d) return { up: t.up, down: t.down, changed: false };
    if (prev !== undefined) voters.delete(vk);
    voters.set(vk, min * 2 + d);
    if (voters.size > VOTER_CAP) voters.delete(voters.keys().next().value);
    if (fresh) {
      // Switch: undo the previous vote, apply the new one.
      if (d) { t.up--; t.down++; } else { t.down--; t.up++; }
    } else if (d) t.down++;
    else t.up++;
    dirty.add(k);
    return { up: t.up, down: t.down, changed: true };
  }

  // Arbitrary step for key-scoped callers (no dedupe). Totals never go below 0.
  function add(slug: string, db: any, entryId: number, field: string, up: number, down: number) {
    const { k, t } = total(slug, db, entryId, field);
    t.up = Math.max(0, t.up + up);
    t.down = Math.max(0, t.down + down);
    dirty.add(k);
    return { up: t.up, down: t.down };
  }

  // Writes dirty totals of one project (or all when slug is omitted).
  function flush(slug?: string) {
    const byDb = new Map<any, string[]>();
    for (const k of dirty) {
      if (slug !== undefined && !k.startsWith(`${slug}\0`)) continue;
      const t = totals.get(k);
      if (!t) continue;
      const list = byDb.get(t.db) ?? [];
      list.push(k);
      byDb.set(t.db, list);
    }
    for (const [db, keys] of byDb) {
      const upsert = db.prepare(
        'INSERT INTO counters (entry_id, field, up, down) VALUES (?, ?, ?, ?) ON CONFLICT (entry_id, field) DO UPDATE SET up = excluded.up, down = excluded.down',
      );
      try {
        db.exec('BEGIN');
        for (const k of keys) {
          const t = totals.get(k)!;
          try {
            upsert.run(t.entryId, t.field, t.up, t.down);
          } catch {
            totals.delete(k); // entry was deleted meanwhile (foreign key)
          }
          dirty.delete(k);
        }
        db.exec('COMMIT');
      } catch {
        try { db.exec('ROLLBACK'); } catch { /* closed */ }
      }
    }
    if (totals.size > TOTALS_CAP) for (const k of totals.keys()) if (!dirty.has(k)) totals.delete(k);
  }

  // Drops a project's in-memory state without writing (project deleted).
  function forget(slug: string) {
    for (const k of totals.keys()) {
      if (!k.startsWith(`${slug}\0`)) continue;
      totals.delete(k);
      dirty.delete(k);
    }
  }

  const timer = setInterval(() => flush(), FLUSH_MS);
  timer.unref?.();

  return { read, vote, add, flush, forget, stop: () => clearInterval(timer) };
}
