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
// - Counter maps: one row per (entry, field, key) in the same table, the field
//   column holding field + "\x1f" + key, count in `up`. Same totals, dirty set
//   and flush. A key "group:option" holds one option per visitor per group
//   (voting another option switches); a key without ":" dedupes on itself.
//   The voter hash covers the group, and `options` keeps the option voted.

import { createHash, randomBytes } from 'node:crypto';

const FLUSH_MS = 5000;
const VOTER_TTL_MIN = 24 * 60;
const VOTER_CAP = 200_000;
const TOTALS_CAP = 100_000;
const SEP = '\x1f';

export function createCounters() {
  const salt = randomBytes(16);
  const voters = new Map<number, number>();
  const options = new Map<number, string>(); // voter hash -> map key voted (counter maps only)
  const totals = new Map<string, { db: any; entryId: number; field: string; up: number; down: number }>();
  const dirty = new Set<string>();
  // Known keys per (entry, map field), loaded with one range read on first use.
  const maps = new Map<string, Set<string>>();

  function evictVoter() {
    const old = voters.keys().next().value;
    voters.delete(old);
    options.delete(old);
  }

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
    if (voters.size > VOTER_CAP) evictVoter();
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

  // Key set of one (entry, map field). The first use reads every row of the
  // map in one range query (primary key order) and caches the totals, so the
  // maxKeys check and map reads never hit the database again.
  function keysOf(slug: string, db: any, entryId: number, field: string) {
    const mk = `${slug}\0${entryId}\0${field}`;
    let s = maps.get(mk);
    if (!s) {
      s = new Set();
      const pre = field + SEP;
      const rows = db.prepare('SELECT field, up FROM counters WHERE entry_id = ? AND field >= ? AND field < ?').all(entryId, pre, `${field}\x20`);
      for (const r of rows) {
        s.add(r.field.slice(pre.length));
        const k = `${mk}${SEP}${r.field.slice(pre.length)}`;
        const t = totals.get(k);
        if (!t) totals.set(k, { db, entryId, field: r.field, up: r.up, down: 0 });
        else t.db = db;
      }
      maps.set(mk, s);
    }
    return s;
  }

  // Totals of one map key. A key missing from the loaded set has no row yet,
  // so it starts at 0 without a lookup.
  function keyTotal(slug: string, db: any, entryId: number, field: string, key: string, s: Set<string>) {
    const k = `${slug}\0${entryId}\0${field}${SEP}${key}`;
    if (!s.has(key) && !totals.has(k)) totals.set(k, { db, entryId, field: field + SEP + key, up: 0, down: 0 });
    return total(slug, db, entryId, field + SEP + key);
  }

  // Current {key: count} of one map field, for read endpoints.
  function readMap(slug: string, db: any, entryId: number, field: string) {
    const out: Record<string, number> = {};
    for (const key of keysOf(slug, db, entryId, field)) out[key] = total(slug, db, entryId, field + SEP + key).t.up;
    return out;
  }

  // One public vote on a map key. Returns null when the key is new and the
  // map already holds maxKeys keys.
  function voteKey(slug: string, db: any, entryId: number, field: string, key: string, maxKeys: number, ip: string, ua: string) {
    const s = keysOf(slug, db, entryId, field);
    if (!s.has(key) && s.size >= maxKeys) return null;
    const colon = key.indexOf(':');
    const scope = colon === -1 ? key : key.slice(0, colon + 1);
    const vk = createHash('sha1').update(salt).update(`${slug}|${ip}|${ua}|${entryId}:${field}${SEP}${scope}`).digest().readUIntBE(0, 6);
    const prev = voters.get(vk);
    const min = Math.floor(Date.now() / 60000);
    const fresh = prev !== undefined && min - (prev >> 1) < VOTER_TTL_MIN;
    const prevKey = fresh ? options.get(vk) : undefined;
    const { k, t } = keyTotal(slug, db, entryId, field, key, s);
    if (prevKey === key) return { key, count: t.up, changed: false };
    if (prev !== undefined) voters.delete(vk);
    voters.set(vk, min * 2);
    options.set(vk, key);
    if (voters.size > VOTER_CAP) evictVoter();
    if (prevKey !== undefined) {
      // Switch within the group: undo the previous option.
      const p = keyTotal(slug, db, entryId, field, prevKey, s);
      p.t.up = Math.max(0, p.t.up - 1);
      dirty.add(p.k);
    }
    s.add(key);
    t.up++;
    dirty.add(k);
    return { key, count: t.up, changed: true };
  }

  // Arbitrary step on a map key for key-scoped callers (no dedupe, floor 0).
  // Returns null when the key is new and the map is full.
  function addKey(slug: string, db: any, entryId: number, field: string, key: string, maxKeys: number, by: number) {
    const s = keysOf(slug, db, entryId, field);
    if (!s.has(key) && s.size >= maxKeys) return null;
    const { k, t } = keyTotal(slug, db, entryId, field, key, s);
    s.add(key);
    t.up = Math.max(0, t.up + by);
    dirty.add(k);
    return { key, count: t.up };
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
    if (totals.size > TOTALS_CAP || maps.size > TOTALS_CAP) {
      for (const k of totals.keys()) if (!dirty.has(k)) totals.delete(k);
      // A key set with an unflushed key stays (its row may not exist yet);
      // evicted totals of its other keys reload lazily.
      for (const [mk, keys] of maps) {
        let keep = false;
        for (const key of keys) if (dirty.has(mk + SEP + key)) { keep = true; break; }
        if (!keep) maps.delete(mk);
      }
    }
  }

  // Drops a project's in-memory state without writing (project deleted).
  function forget(slug: string) {
    for (const k of totals.keys()) {
      if (!k.startsWith(`${slug}\0`)) continue;
      totals.delete(k);
      dirty.delete(k);
    }
    for (const mk of maps.keys()) if (mk.startsWith(`${slug}\0`)) maps.delete(mk);
  }

  const timer = setInterval(() => flush(), FLUSH_MS);
  timer.unref?.();

  return { read, vote, add, readMap, voteKey, addKey, flush, forget, stop: () => clearInterval(timer) };
}
