// Counter design lab. Throwaway prototypes of the counter-field bump path, one
// server per variant over real HTTP, same load for all. Not part of the CMS.
//
//   node bench/counter-lab.mjs                 # all variants
//   node bench/counter-lab.mjs v4 v6           # some
//   LAB_REQS=100000 node bench/counter-lab.mjs
//
// Variants (server-side cost of one public "vote" request):
//   v0 floor        : parse + reply, no state. HTTP and JSON cost only.
//   v1 db-direct    : UPSERT ... RETURNING per request, no dedupe.
//   v2 db+dedupe    : in-memory voter map (salted hash of ip|ua) + UPSERT per request.
//   v3 batched      : totals held in memory, dirty keys flushed on a timer. No dedupe.
//   v4 batched+dedupe : v3 plus the in-memory voter map. Proposed default.
//   v5 token+batched: stateless HMAC token echoed by the client, v3 storage.
//   v7 batched+compact dedupe: v4 with a numeric 48-bit hash key and a packed number value (smaller map).
//   v6 temp-log     : row per vote with ip/ua/lang in a table, aggregated and purged on a timer.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { request, Agent } from 'node:http';
import { performance } from 'node:perf_hooks';

const ENTRIES = 200;
const FLUSH_MS = 5000;
const MAP_CAP = 200_000;
const TTL_MS = 24 * 3600_000;

// ---------------------------------------------------------------- server mode
if (process.argv[2] === '--serve') {
  const variant = process.argv[3];
  const port = Number(process.argv[4]);
  const dir = mkdtempSync(path.join(tmpdir(), 'counter-lab-'));
  const db = new DatabaseSync(path.join(dir, 'lab.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(`CREATE TABLE counters (entry INTEGER, field TEXT, up INTEGER NOT NULL DEFAULT 0, down INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (entry, field)) WITHOUT ROWID;
           CREATE TABLE votes_log (id INTEGER PRIMARY KEY, ts TEXT DEFAULT CURRENT_TIMESTAMP, ip TEXT, ua TEXT, lang TEXT, entry INTEGER, field TEXT, dir TEXT);
           CREATE INDEX votes_log_voter ON votes_log (entry, field, ip, ua);`);

  let dbWrites = 0;
  const salt = randomBytes(16);
  const secret = randomBytes(32);

  const upsertDelta = db.prepare(`INSERT INTO counters (entry, field, up, down) VALUES (?, ?, ?, ?)
    ON CONFLICT (entry, field) DO UPDATE SET up = up + excluded.up, down = down + excluded.down RETURNING up, down`);
  const selCounter = db.prepare('SELECT up, down FROM counters WHERE entry = ? AND field = ?');
  const upsertAbs = db.prepare(`INSERT INTO counters (entry, field, up, down) VALUES (?, ?, ?, ?)
    ON CONFLICT (entry, field) DO UPDATE SET up = excluded.up, down = excluded.down`);

  // Voter map: key -> [dir, ts]. Insertion order = age order, so evicting the
  // first key is evicting the oldest. No timer, expiry is checked on lookup.
  const voters = new Map();
  const voterKey = (ip, ua, entry, field) =>
    createHash('sha1').update(salt).update(ip).update('|').update(ua).update('|').update(`${entry}:${field}`).digest('base64').slice(0, 16);
  // Returns [delta up, delta down, noop]. Records the new vote.
  function judge(ip, ua, entry, field, dir) {
    const k = voterKey(ip, ua, entry, field);
    const prev = voters.get(k);
    const now = Date.now();
    if (prev && now - prev[1] < TTL_MS) {
      if (prev[0] === dir) return [0, 0, true];
      voters.delete(k);
      voters.set(k, [dir, now]);
      return dir === 'u' ? [1, -1, false] : [-1, 1, false];
    }
    if (prev) voters.delete(k);
    voters.set(k, [dir, now]);
    if (voters.size > MAP_CAP) voters.delete(voters.keys().next().value);
    return dir === 'u' ? [1, 0, false] : [0, 1, false];
  }

  // Compact map: Map<number, number>. Key = 48 bits of the salted hash, value = minutes*2 + (dir is 'd').
  const cvoters = new Map();
  function judgeCompact(ip, ua, entry, field, dir) {
    const k = createHash('sha1').update(salt).update(ip).update('|').update(ua).update('|').update(`${entry}:${field}`).digest().readUIntBE(0, 6);
    const prev = cvoters.get(k);
    const min = Math.floor(Date.now() / 60000);
    const d = dir === 'd' ? 1 : 0;
    if (prev !== undefined && min - (prev >> 1) < TTL_MS / 60000) {
      if ((prev & 1) === d) return [0, 0, true];
      cvoters.delete(k);
      cvoters.set(k, min * 2 + d);
      return d ? [-1, 1, false] : [1, -1, false];
    }
    if (prev !== undefined) cvoters.delete(k);
    cvoters.set(k, min * 2 + d);
    if (cvoters.size > MAP_CAP) cvoters.delete(cvoters.keys().next().value);
    return d ? [0, 1, false] : [1, 0, false];
  }

  // Batched totals: memory is authoritative between flushes.
  const totals = new Map(); // "entry:field" -> {up, down}
  const dirty = new Set();
  function total(entry, field) {
    const k = `${entry}:${field}`;
    let t = totals.get(k);
    if (!t) {
      const r = selCounter.get(entry, field);
      totals.set(k, (t = { up: r?.up ?? 0, down: r?.down ?? 0 }));
    }
    return [k, t];
  }
  function flush() {
    if (!dirty.size) return;
    db.exec('BEGIN');
    for (const k of dirty) {
      const [e, f] = k.split(':');
      const t = totals.get(k);
      upsertAbs.run(Number(e), f, t.up, t.down);
      dbWrites++;
    }
    db.exec('COMMIT');
    dirty.clear();
  }
  const timers = [];
  if (variant === 'v3' || variant === 'v4' || variant === 'v5' || variant === 'v7') timers.push(setInterval(flush, FLUSH_MS));

  // v6: log table. Aggregate folds the log into counters then deletes it.
  const logLast = db.prepare('SELECT dir FROM votes_log WHERE entry = ? AND field = ? AND ip = ? AND ua = ? ORDER BY id DESC LIMIT 1');
  const logIns = db.prepare('INSERT INTO votes_log (ip, ua, lang, entry, field, dir) VALUES (?, ?, ?, ?, ?, ?)');
  const logPending = db.prepare(`SELECT COALESCE(SUM(dir = 'u'), 0) AS up, COALESCE(SUM(dir = 'd'), 0) AS down FROM votes_log WHERE entry = ? AND field = ?`);
  function aggregate() {
    db.exec('BEGIN');
    db.exec(`INSERT INTO counters (entry, field, up, down)
             SELECT entry, field, SUM(dir = 'u'), SUM(dir = 'd') FROM votes_log GROUP BY entry, field
             ON CONFLICT (entry, field) DO UPDATE SET up = up + excluded.up, down = down + excluded.down`);
    db.exec('DELETE FROM votes_log');
    db.exec('COMMIT');
  }
  if (variant === 'v6') timers.push(setInterval(aggregate, 10_000));

  function bump(variantName, ip, ua, lang, entry, field, dir, token) {
    switch (variantName) {
      case 'v0':
        return { up: 0, down: 0 };
      case 'v1': {
        dbWrites++;
        return upsertDelta.get(entry, field, dir === 'u' ? 1 : 0, dir === 'd' ? 1 : 0);
      }
      case 'v2': {
        const [du, dd, noop] = judge(ip, ua, entry, field, dir);
        if (noop) return selCounter.get(entry, field) ?? { up: 0, down: 0 };
        dbWrites++;
        return upsertDelta.get(entry, field, du, dd);
      }
      case 'v3': {
        const [k, t] = total(entry, field);
        if (dir === 'u') t.up++; else t.down++;
        dirty.add(k);
        return t;
      }
      case 'v4': {
        const [du, dd, noop] = judge(ip, ua, entry, field, dir);
        const [k, t] = total(entry, field);
        if (!noop) { t.up += du; t.down += dd; dirty.add(k); }
        return t;
      }
      case 'v7': {
        const [du, dd, noop] = judgeCompact(ip, ua, entry, field, dir);
        const [k, t] = total(entry, field);
        if (!noop) { t.up += du; t.down += dd; dirty.add(k); }
        return t;
      }
      case 'v5': {
        // Token = HMAC(entry:field:dir). Client echoes the token of its last vote here.
        const mac = (d) => createHmac('sha256', secret).update(`${entry}:${field}:${d}`).digest('base64url').slice(0, 16);
        let du = dir === 'u' ? 1 : 0, dd = dir === 'd' ? 1 : 0;
        if (token) {
          const prev = token === mac('u') ? 'u' : token === mac('d') ? 'd' : null;
          if (prev === dir) { du = 0; dd = 0; }
          else if (prev) { du = dir === 'u' ? 1 : -1; dd = -du; }
        }
        const [k, t] = total(entry, field);
        if (du || dd) { t.up += du; t.down += dd; dirty.add(k); }
        return { up: t.up, down: t.down, token: mac(dir) };
      }
      case 'v6': {
        const last = logLast.get(entry, field, ip, ua)?.dir;
        // Voters already folded into counters are not seen here: known weakness of the design.
        if (last !== (dir === 'u' ? 'u' : 'd')) {
          logIns.run(ip, ua, lang, entry, field, dir);
          dbWrites++;
        }
        const c = selCounter.get(entry, field) ?? { up: 0, down: 0 };
        const p = logPending.get(entry, field);
        return { up: c.up + p.up, down: c.down + p.down };
      }
    }
  }

  const server = createServer((req, res) => {
    const u = req.url;
    if (u === '/_stats') {
      if (variant === 'v6') aggregate(); else flush();
      const rows = db.prepare('SELECT entry, field, up, down FROM counters').all();
      const body = JSON.stringify({ rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed, dbWrites, voters: voters.size + cvoters.size, rows });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body); return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const m = /^\/v\/(\d+)\/(\w+)$/.exec(u);
      if (!m) { res.writeHead(404); res.end(); return; }
      let b;
      try { b = JSON.parse(raw); } catch { res.writeHead(400); res.end(); return; }
      if (b.dir !== 'u' && b.dir !== 'd') { res.writeHead(400); res.end(); return; }
      const out = bump(variant, req.headers['x-forwarded-for'] || req.socket.remoteAddress || '', req.headers['user-agent'] || '', req.headers['accept-language'] || '', Number(m[1]), m[2], b.dir, b.token);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  server.listen(port, '127.0.0.1', () => process.stdout.write('ready\n'));
  process.on('SIGTERM', () => { timers.forEach(clearInterval); server.close(); rmSync(dir, { recursive: true, force: true }); process.exit(0); });
} else {
  // -------------------------------------------------------------- driver mode
  const REQS = Number(process.env.LAB_REQS || 60000);
  const CONC = 64;
  const VOTERS = 4000;
  const names = { v0: 'floor (no state)', v1: 'db-direct', v2: 'db + dedupe map', v3: 'batched', v4: 'batched + dedupe map', v5: 'token + batched', v6: 'temp log table', v7: 'batched + compact dedupe' };
  const picks = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(names);

  const agent = new Agent({ keepAlive: true, maxSockets: CONC });
  function post(port, urlPath, headers, body) {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: urlPath, method: 'POST', agent, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => resolve(s));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  function get(port, urlPath) {
    return new Promise((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: urlPath, agent }, (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => resolve(JSON.parse(s)));
      }).on('error', reject).end();
    });
  }

  // Deterministic plan: same request stream for every variant. Voter i belongs
  // to worker i % CONC so one voter never has two requests in flight.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const plan = Array.from({ length: CONC }, () => []);
  const oracle = new Map(); // voter:entry -> last dir
  const rawUp = new Map();
  for (let i = 0; i < REQS; i++) {
    const voter = Math.floor(rnd() * VOTERS);
    const entry = 1 + Math.floor(rnd() * ENTRIES);
    const prev = oracle.get(`${voter}:${entry}`);
    // 45% repeat the same vote, 10% switch, rest fresh
    let dir = rnd() < 0.5 ? 'u' : 'd';
    if (prev) { const r = rnd(); dir = r < 0.45 ? prev : r < 0.55 ? (prev === 'u' ? 'd' : 'u') : dir; }
    oracle.set(`${voter}:${entry}`, dir);
    rawUp.set(entry, [(rawUp.get(entry)?.[0] ?? 0) + (dir === 'u' ? 1 : 0), (rawUp.get(entry)?.[1] ?? 0) + (dir === 'd' ? 1 : 0)]);
    plan[voter % CONC].push({ voter, entry, dir });
  }
  const expectDedupe = new Map();
  for (const [k, dir] of oracle) {
    const e = Number(k.split(':')[1]);
    const t = expectDedupe.get(e) ?? [0, 0];
    t[dir === 'u' ? 0 : 1]++;
    expectDedupe.set(e, t);
  }

  const results = [];
  let port = 4830;
  for (const v of picks) {
    port++;
    const child = spawn('taskset', ['-c', '0', process.execPath, '--max-old-space-size=768', new URL(import.meta.url).pathname, '--serve', v, String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((r) => child.stdout.once('data', r));
    const lat = [];
    const tokens = new Map();
    const t0 = performance.now();
    await Promise.all(plan.map(async (list) => {
      for (const { voter, entry, dir } of list) {
        const key = `${voter}:${entry}`;
        const body = JSON.stringify({ dir, token: tokens.get(key) });
        const s = performance.now();
        const out = await post(port, `/v/${entry}/likes`, { 'X-Forwarded-For': `10.0.${voter >> 8}.${voter & 255}`, 'User-Agent': `lab-agent/${voter % 50} (Linux; rv:${voter % 7})`, 'Accept-Language': 'en-US,en;q=0.9' }, body);
        lat.push(performance.now() - s);
        if (v === 'v5') tokens.set(key, JSON.parse(out).token);
      }
    }));
    const wall = performance.now() - t0;
    const stats = await get(port, '/_stats');
    lat.sort((a, b) => a - b);
    // Correctness: compare final DB totals to the oracle.
    let wrong = 0;
    const want = v === 'v1' || v === 'v3' ? rawUp : expectDedupe;
    if (v !== 'v0') {
      const got = new Map(stats.rows.map((r) => [r.entry, [r.up, r.down]]));
      for (const [e, [u, d]] of want) { const g = got.get(e) || [0, 0]; if (g[0] !== u || g[1] !== d) wrong++; }
    }
    results.push({
      variant: `${v} ${names[v]}`,
      reqs_per_s: Math.round(REQS / (wall / 1000)),
      p50_ms: +lat[Math.floor(lat.length * 0.5)].toFixed(2),
      p99_ms: +lat[Math.floor(lat.length * 0.99)].toFixed(2),
      db_writes: stats.dbWrites,
      voter_map: stats.voters,
      rss_mb: Math.round(stats.rss / 1048576),
      wrong_entries: v === 'v0' ? 'n/a' : wrong,
    });
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
  }
  agent.destroy();
  console.log(`requests ${REQS}, concurrency ${CONC}, voters ${VOTERS}, entries ${ENTRIES}, server pinned to 1 core`);
  console.table(results);
  console.log(JSON.stringify(results));
}
