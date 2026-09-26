// Benchmark driver v2 for Boring CMS. Plain Node, zero dependencies.
//
// Design goals over bench.mjs (v1, kept unchanged for its result history):
//   - Field-type coverage is automatic: the driver asks the running server
//     GET /api/v1/<project>/field-types and generates write + read phases for
//     every type it reports. A new field type shipped in lib/content.ts gets
//     benchmarked here with zero driver changes (add one line to VALUES only
//     if its value shape cannot default to a string).
//   - Per-field isolation: each type gets its own single-field collection, so
//     a slowdown names the field type, not a mixed "misc" collection.
//   - Longer phases than v1 (v1 whole runs were ~10s wall, which made single
//     runs noisy); v2 trades a ~90s run for steadier numbers.
//   - Works against old server versions: types the server does not report are
//     simply not benchmarked, so one driver produces a comparable history
//     across versions (see bench/run2.sh).
//
// Usage: node bench/bench2.mjs --base http://127.0.0.1:4710 --out results.json [--label L] [--scale N]

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const base = arg('base');
const outPath = arg('out');
const label = arg('label', 'unlabeled');
const scale = Number(arg('scale', '1'));
if (!base || !outPath) {
  console.error('usage: node bench/bench2.mjs --base URL --out FILE [--label L] [--scale N]');
  process.exit(2);
}

const project = 'bench2';
let cookie = null;
let readKey = null;
let writeKey = null;

// ---------- HTTP ----------

async function form(method, urlPath, fields) {
  const res = await fetch(base + urlPath, {
    method,
    redirect: 'manual',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: fields ? new URLSearchParams(fields).toString() : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return res;
}

const api = (urlPath, init = {}) =>
  fetch(base + urlPath, { ...init, headers: { Authorization: `Bearer ${init.write ? writeKey : readKey}`, ...(init.headers || {}) } });

let mcpId = 0;
async function mcp(tool, args) {
  const res = await fetch(`${base}/mcp/${project}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpId, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  const json = await res.json();
  if (json.error || json.result?.isError) {
    throw new Error(`MCP ${tool}: ${JSON.stringify(json.error || json.result.content?.[0]?.text).slice(0, 200)}`);
  }
  return JSON.parse(json.result.content[0].text);
}

function expectStatus(res, ...codes) {
  if (!codes.includes(res.status)) throw new Error(`unexpected status ${res.status}`);
  return res;
}

// Distinct fake visitor per request, so public-vote dedupe does not collapse
// the phase into no-ops. Needs TRUST_PROXY=1 on the server (run2.sh sets it).
const rnd = (n) => Math.floor(Math.random() * n);
const visitor = () => ({
  'X-Forwarded-For': `10.${rnd(255)}.${rnd(255)}.${rnd(255)}`,
  'User-Agent': `bench2/${rnd(1e6)}`,
});

// ---------- measurement (same output shape as v1, summarize.mjs renders both) ----------

const phases = [];
const percentile = (s, p) => (s.length ? s[Math.max(0, Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1))] : null);

async function phase(name, n, fn, { concurrency = 1 } = {}) {
  const samples = [];
  let errors = 0;
  let lastErr = null;
  const startedEpochMs = Date.now();
  const started = process.hrtime.bigint();
  let next = 0;
  async function worker() {
    while (next < n) {
      const i = next++;
      const t0 = process.hrtime.bigint();
      try {
        await fn(i);
      } catch (e) {
        errors++;
        lastErr = e;
      }
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, n) }, worker));
  if (errors > n * 0.05) throw new Error(`phase ${name}: >5% errors, last: ${lastErr?.message}`);
  const totalMs = Number(process.hrtime.bigint() - started) / 1e6;
  samples.sort((a, b) => a - b);
  const row = {
    name, count: n, concurrency, errors,
    start_epoch_ms: startedEpochMs, end_epoch_ms: Date.now(),
    total_ms: Math.round(totalMs * 10) / 10,
    ops_per_sec: Math.round((n / totalMs) * 1000 * 10) / 10,
    p50_ms: Math.round(percentile(samples, 50) * 100) / 100,
    p95_ms: Math.round(percentile(samples, 95) * 100) / 100,
    p99_ms: Math.round(percentile(samples, 99) * 100) / 100,
    max_ms: Math.round(samples[samples.length - 1] * 100) / 100,
  };
  phases.push(row);
  console.error(`  ${name}: ${row.ops_per_sec} ops/s, p50 ${row.p50_ms}ms, p95 ${row.p95_ms}ms, errors ${errors}`);
  return row;
}

// ---------- field type protocols ----------

// Entry data value per type. A type absent here (including any future one)
// defaults to a string; if the server rejects that, the phase fails loud at
// the >5% error gate, which is the signal to add its line.
const VALUES = {
  text: (i) => `Sample text value number ${i} with enough length to be realistic.`,
  markdown: (i) => `## Heading ${i}\n\nParagraph one of entry ${i}. `.repeat(8),
  number: (i) => i * 7,
  boolean: (i) => i % 2 === 0,
  date: (i) => `2026-0${(i % 9) + 1}-1${i % 9}`,
  datetime: (i) => `2026-0${(i % 9) + 1}-1${i % 9}T0${i % 9}:30:00Z`,
  json: (i) => ({ index: i, tags: ['a', 'b'], nested: { ok: true } }),
  image: () => `/media/${project}/pic.png`,
  relation: (i) => `t-${i % 20}`,
};

// Server-managed types carry no entry data; they get vote phases instead.
const NO_DATA = new Set(['counter', 'countermap']);

const N = (n) => Math.max(1, Math.round(n * scale));
const col = (type) => `f-${type}`;

async function fieldPhases(type, hasField) {
  const c = col(type);
  const slugs = [];
  const data = (i) => (NO_DATA.has(type) ? {} : { val: VALUES[type] ? VALUES[type](i) : `sample-${i}` });

  await phase(`field_${type}_write`, N(500), async (i) => {
    await mcp('create_entry', { collection: c, slug: `e-${i}`, data: data(i), publish: true });
    slugs.push(`e-${i}`);
  });
  await phase(`field_${type}_read`, N(5000), async (i) => {
    expectStatus(await api(`/api/v1/${project}/${c}/${slugs[i % slugs.length]}`), 200);
  }, { concurrency: 16 });

  if (type === 'counter') {
    await phase('field_counter_vote', N(20000), async (i) => {
      expectStatus(await api(`/api/v1/${project}/${c}/e-0/counters/val?dir=${i % 3 ? 'up' : 'down'}`, { method: 'POST', headers: visitor() }), 200);
    }, { concurrency: 32 });
    await phase('field_counter_read_totals', N(5000), async () => {
      expectStatus(await api(`/api/v1/${project}/${c}/e-0/counters`), 200);
    }, { concurrency: 16 });
  }
  if (type === 'countermap') {
    await phase('field_countermap_vote', N(20000), async () => {
      expectStatus(await api(`/api/v1/${project}/${c}/e-0/counters/val/r${rnd(16)}`, { method: 'POST', headers: visitor() }), 200);
    }, { concurrency: 32 });
    // 200 voters flipping between poll options: the vote-switch path.
    const voters = Array.from({ length: 200 }, () => visitor());
    await phase('field_countermap_switch', N(20000), async (i) => {
      expectStatus(await api(`/api/v1/${project}/${c}/e-0/counters/val/poll:o${rnd(5)}`, { method: 'POST', headers: voters[i % voters.length] }), 200);
    }, { concurrency: 32 });
    await phase('field_countermap_read_totals', N(5000), async () => {
      expectStatus(await api(`/api/v1/${project}/${c}/e-0/counters`), 200);
    }, { concurrency: 16 });
  }
}

// ---------- main ----------

async function main() {
  const t0 = Date.now();

  // Bootstrap (untimed): setup, project, rate limit, keys.
  expectStatus(await form('POST', '/setup', { email: 'bench@example.com', password: 'bench-password-1234', password_confirm: 'bench-password-1234' }), 302);
  expectStatus(await form('POST', '/admin/projects', { name: 'Bench2', slug: project }), 302);
  expectStatus(await form('POST', `/admin/projects/${project}/rate-limit`, { rate_limit_per_min: '100000000' }), 302);
  readKey = ((await (await form('POST', `/admin/projects/${project}/api-keys`, { name: 'b2-read' })).text()).match(/yn_[A-Za-z0-9_-]+/) || [])[0];
  writeKey = ((await (await form('POST', `/admin/projects/${project}/api-keys`, { name: 'b2-write', scope: 'write', mcp: '1' })).text()).match(/yn_[A-Za-z0-9_-]+/) || [])[0];
  if (!readKey || !writeKey) throw new Error('could not extract API keys');

  // Discover what this server version supports.
  const ft = await (await api(`/api/v1/${project}/field-types`)).json();
  const types = Object.keys(ft.types || {});
  console.error(`field types reported by server: ${types.join(', ')}`);

  // One single-field collection per type, plus a relation target. Options a
  // type requires: relation needs its target collection; everything else is
  // plain. Applied in one schema POST.
  const collections = [
    { slug: 'targets', name: 'Targets', fields: [{ name: 'title', label: 'Title', type: 'text' }] },
    ...types.map((t) => ({
      slug: col(t),
      name: `Field ${t}`,
      fields: [{ name: 'val', label: 'Val', type: t, ...(t === 'relation' ? { collection: 'targets' } : {}) }],
    })),
  ];
  const bootstrapMs = Date.now() - t0;

  await phase('schema_apply', N(10), async () => {
    expectStatus(await api(`/api/v1/${project}/schema`, {
      method: 'POST', write: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collections }),
    }), 200);
  });

  // Relation targets (untimed seed).
  for (let i = 0; i < 20; i++) await mcp('create_entry', { collection: 'targets', slug: `t-${i}`, data: { title: `Target ${i}` }, publish: true });

  // Per-field-type coverage, automatic.
  for (const t of types) await fieldPhases(t);

  // Core endpoint coverage on the text collection (largest read surface).
  const c = col('text');
  await phase('core_list', N(5000), async () => {
    expectStatus(await api(`/api/v1/${project}/${c}`), 200);
  }, { concurrency: 16 });
  const etag = (await api(`/api/v1/${project}/${c}`)).headers.get('etag');
  await phase('core_304_etag', N(5000), async () => {
    expectStatus(await api(`/api/v1/${project}/${c}`, { headers: { 'If-None-Match': etag } }), 304, 200);
  }, { concurrency: 16 });
  await phase('core_hot_mixed', N(20000), async (i) => {
    if (i % 10 < 7) expectStatus(await api(`/api/v1/${project}/${c}/e-0`), 200);
    else expectStatus(await api(`/api/v1/${project}/${c}`), 200);
  }, { concurrency: 32 });

  const boundary = 'bench2boundary';
  const mpBody = (i) => Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="up-${i}.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.alloc(64 * 1024, i % 251),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const mediaUrls = [];
  await phase('core_media_upload_64kb', N(150), async (i) => {
    const res = expectStatus(await api(`/api/v1/${project}/media`, {
      method: 'POST', write: true, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: mpBody(i),
    }), 200, 201);
    mediaUrls.push((await res.json()).url);
  });
  await phase('core_media_serve_64kb', N(3000), async (i) => {
    await (expectStatus(await fetch(base + mediaUrls[i % mediaUrls.length]), 200)).arrayBuffer();
  }, { concurrency: 16 });

  await phase('core_update', N(500), async (i) => {
    await mcp('update_entry', { collection: c, slug: `e-${i % 500}`, data: { val: `updated ${i}` } });
  });
  await phase('core_delete', N(500), async (i) => {
    await mcp('delete_entry', { collection: c, slug: `e-${i % 500}` });
  });

  const result = {
    label, base, scale,
    started_at: new Date(t0).toISOString(),
    bootstrap_ms: bootstrapMs,
    total_wall_ms: Date.now() - t0,
    driver: `node ${process.version} (bench2)`,
    field_types: types,
    phases,
  };
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.error(`wrote ${outPath} (${Math.round((Date.now() - t0) / 1000)}s wall)`);
}

main().catch((e) => {
  console.error(`bench2 failed: ${e.message}`);
  process.exit(1);
});
