// Benchmark driver for Boring CMS. Plain Node, zero dependencies.
// Talks to an already-running server over HTTP only (the orchestrator
// bench/run.sh starts the server on a fresh temp data dir and pins CPUs).
//
// Usage:
//   node bench/bench.mjs --base http://127.0.0.1:4710 --out results.json \
//     [--label node-1cpu] [--scale 1]
//
// The driver bootstraps everything it needs through the public surface:
// setup -> login -> project -> rate limit raise -> API keys -> schema apply,
// then runs the timed phases and writes one JSON result file.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const argv = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
}
const base = arg('base');
const outPath = arg('out');
const label = arg('label', 'unlabeled');
const scale = Number(arg('scale', '1')); // multiply op counts, 1 = default
// Size of the bulk cosmetic ref-rewrite pair map. Each pair is a full-table
// instr() scan on the current code, so this is the dimension that blows up on
// large datasets (2216 pairs -> 2216 scans -> gateway timeout). Kept small by
// default so the bench finishes; crank it (and --scale) to approach that locally.
// --soak SECONDS: sustained mixed read load (single, list, 304) after the
// seed phases, for throughput drift and memory-over-time. --soak-only skips
// every other phase; --soak-scheduled seeds future-dated entries first.
const soakSec = Number(arg('soak', '0'));
const soakOnly = argv.includes('--soak-only');
const soakScheduled = argv.includes('--soak-scheduled');
const rewritePairs = Number(arg('rewrite-pairs', '200'));
if (!base || !outPath) {
  console.error('usage: node bench/bench.mjs --base URL --out FILE [--label L] [--scale N]');
  process.exit(2);
}

const project = 'bench';
let cookie = null;
let readKey = null;
let writeKey = null;

// ---------- HTTP helpers ----------

function withCookie(headers = {}) {
  return cookie ? { ...headers, Cookie: cookie } : headers;
}

async function form(method, urlPath, fields) {
  const res = await fetch(base + urlPath, {
    method,
    redirect: 'manual',
    headers: withCookie(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    body: fields ? new URLSearchParams(fields).toString() : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return res;
}

async function api(urlPath, init = {}) {
  return fetch(base + urlPath, {
    ...init,
    headers: { Authorization: `Bearer ${init.write ? writeKey : readKey}`, ...(init.headers || {}) },
  });
}

let mcpId = 0;
async function mcp(tool, args, { key = null } = {}) {
  const res = await fetch(`${base}/mcp/${project}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key || writeKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++mcpId, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  const json = await res.json();
  if (json.error || json.result?.isError) {
    throw new Error(`MCP ${tool} failed: ${JSON.stringify(json.error || json.result.content?.[0]?.text).slice(0, 300)}`);
  }
  return JSON.parse(json.result.content[0].text);
}

// Generic REST tool endpoint (same TOOLS registry as /mcp, plain Bearer key,
// no JSON-RPC framing). Mirrors mcp() so a phase can compare transport cost.
async function restCall(tool, args, { key = null } = {}) {
  const res = await fetch(`${base}/api/v1/${project}/call/${tool}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key || writeKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`REST /call ${tool} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---------- measurement ----------

const phases = [];

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// Runs fn(i) n times sequentially, timing each op.
async function phase(name, n, fn, { concurrency = 1 } = {}) {
  const samples = [];
  let errors = 0;
  const startedEpochMs = Date.now();
  const started = process.hrtime.bigint();
  if (concurrency === 1) {
    for (let i = 0; i < n; i++) {
      const t0 = process.hrtime.bigint();
      try {
        await fn(i);
      } catch (e) {
        errors++;
        if (errors > n * 0.05) throw new Error(`phase ${name}: >5% errors, last: ${e.message}`);
      }
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  } else {
    let next = 0;
    async function worker() {
      while (next < n) {
        const i = next++;
        const t0 = process.hrtime.bigint();
        try {
          await fn(i);
        } catch {
          errors++;
        }
        samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
  }
  const totalMs = Number(process.hrtime.bigint() - started) / 1e6;
  samples.sort((a, b) => a - b);
  const row = {
    name,
    count: n,
    concurrency,
    errors,
    start_epoch_ms: startedEpochMs,
    end_epoch_ms: Date.now(),
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

function expectStatus(res, ...codes) {
  if (!codes.includes(res.status)) throw new Error(`unexpected status ${res.status}`);
  return res;
}

// ---------- fixtures ----------

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';
const longBody = ('## Section\n\n' + LOREM.repeat(8) + '\n\n').repeat(6); // ~5.5 KB markdown

// Full https asset URLs that the rewrite phase swaps (.png -> .webp), the real
// R2 migration shape. Spread across long-article bodies so each pool URL lands
// in >=1 entry (when the pool fits); any surplus pairs are decoys that match
// nothing but still cost a full scan, exactly like a 2216-pair map on a large site.
const ASSETS_PER_BODY = 6;
const assetPng = (k) => `https://assets.bench.test/media/asset-${k}.png`;
const assetWebp = (k) => `https://assets.bench.test/media/asset-${k}.webp`;
const bodyAssets = (i) =>
  Array.from({ length: ASSETS_PER_BODY }, (_, j) =>
    `![img](${assetPng((i * ASSETS_PER_BODY + j) % rewritePairs)})`,
  ).join('\n');

const shortData = (i) => ({ title: `Short post ${i}`, body: `Body of short post ${i}. ${LOREM}` });
const longData = (i) => ({
  title: `Long article ${i}`,
  subtitle: `An extensively detailed subtitle for article ${i}`,
  author: 'Bench Author',
  category: 'benchmarks',
  tags: 'alpha, beta, gamma, delta',
  seo_title: `Long article ${i} - Boring CMS bench`,
  seo_description: LOREM.slice(0, 155),
  hero: `/media/${project}/bench-hero.png`,
  body: `${longBody}\n\n${bodyAssets(i)}`,
  summary: LOREM.repeat(2),
  views: i * 7,
  rating: (i % 5) + 1,
  featured: i % 10 === 0 ? 'yes' : 'no',
  source_url: `https://example.com/articles/${i}`,
});

const SHORT_SCHEMA = {
  slug: 'short-posts',
  name: 'Short Posts',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'body', label: 'Body', type: 'markdown' },
  ],
};
const LONG_SCHEMA = {
  slug: 'long-articles',
  name: 'Long Articles',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'subtitle', label: 'Subtitle', type: 'text' },
    { name: 'author', label: 'Author', type: 'text' },
    { name: 'category', label: 'Category', type: 'text' },
    { name: 'tags', label: 'Tags', type: 'text' },
    { name: 'seo_title', label: 'SEO Title', type: 'text' },
    { name: 'seo_description', label: 'SEO Description', type: 'text' },
    { name: 'hero', label: 'Hero', type: 'image' },
    { name: 'body', label: 'Body', type: 'markdown' },
    { name: 'summary', label: 'Summary', type: 'markdown' },
    { name: 'views', label: 'Views', type: 'number' },
    { name: 'rating', label: 'Rating', type: 'number' },
    { name: 'featured', label: 'Featured', type: 'text' },
    { name: 'source_url', label: 'Source URL', type: 'text' },
  ],
};

function multipart(filename, data, boundary = 'benchboundary') {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, data, tail]), type: `multipart/form-data; boundary=${boundary}` };
}

// ---------- main ----------

const N = (n) => Math.max(1, Math.round(n * scale));

async function main() {
  const t0 = Date.now();

  // Bootstrap (untimed): setup admin, project, rate limit, keys, seed media ref.
  expectStatus(await form('POST', '/setup', { email: 'bench@example.com', password: 'bench-password-1234', password_confirm: 'bench-password-1234' }), 302);
  expectStatus(await form('POST', '/admin/projects', { name: 'Bench', slug: project }), 302);
  // Raise the per-key rate limit far above anything the bench produces; the
  // default 60 req/min would turn the whole run into a 429 measurement.
  expectStatus(await form('POST', `/admin/projects/${project}/rate-limit`, { rate_limit_per_min: '100000000' }), 302);

  const readKeyPage = await form('POST', `/admin/projects/${project}/api-keys`, { name: 'bench-read' });
  readKey = ((await readKeyPage.text()).match(/yn_[A-Za-z0-9_-]+/) || [])[0];
  // mcp:'1' required since v0.13.0: MCP access is opt-in per key, and the
  // write phases below drive create/update/delete through the MCP endpoint.
  const writeKeyPage = await form('POST', `/admin/projects/${project}/api-keys`, { name: 'bench-write', scope: 'write', mcp: '1' });
  writeKey = ((await writeKeyPage.text()).match(/yn_[A-Za-z0-9_-]+/) || [])[0];
  if (!readKey || !writeKey) throw new Error('could not extract API keys');
  const bootstrapMs = Date.now() - t0;

  async function runSoak(slugs) {
    if (soakScheduled) {
      const future = new Date(Date.now() + 86400e3).toISOString();
      for (let i = 0; i < 100; i++) {
        await mcp('create_entry', { collection: 'short-posts', slug: `soak-sched-${i}`, data: shortData(i) });
        await mcp('publish_entry', { collection: 'short-posts', slug: `soak-sched-${i}`, at: future });
      }
    }
    const listEtag = (await api(`/api/v1/${project}/short-posts`)).headers.get('etag');
    const BUCKET_MS = 30000;
    const buckets = [];
    const all = [];
    let errors = 0;
    let next = 0;
    const startedEpochMs = Date.now();
    const endAt = startedEpochMs + soakSec * 1000;
    async function worker() {
      while (Date.now() < endAt) {
        const i = next++;
        const r = i % 10;
        const t0 = process.hrtime.bigint();
        try {
          if (r < 6) expectStatus(await api(`/api/v1/${project}/short-posts/${slugs[i % slugs.length]}`), 200);
          else if (r < 8) expectStatus(await api(`/api/v1/${project}/short-posts`), 200);
          else expectStatus(await api(`/api/v1/${project}/short-posts`, { headers: { 'If-None-Match': listEtag } }), 304, 200);
        } catch { errors++; }
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const b = Math.floor((Date.now() - startedEpochMs) / BUCKET_MS);
        (buckets[b] ||= []).push(ms);
        all.push(ms);
      }
    }
    await Promise.all(Array.from({ length: 20 }, worker));
    const totalMs = Date.now() - startedEpochMs;
    all.sort((a, b) => a - b);
    const row = {
      name: 'soak', count: all.length, concurrency: 20, errors,
      start_epoch_ms: startedEpochMs, end_epoch_ms: Date.now(), total_ms: totalMs,
      ops_per_sec: Math.round((all.length / totalMs) * 1000 * 10) / 10,
      p50_ms: Math.round(percentile(all, 50) * 100) / 100,
      p95_ms: Math.round(percentile(all, 95) * 100) / 100,
      p99_ms: Math.round(percentile(all, 99) * 100) / 100,
      max_ms: Math.round(all[all.length - 1] * 100) / 100,
      buckets: buckets.map((b) => { b.sort((x, y) => x - y); return { ops_per_sec: Math.round((b.length / (BUCKET_MS / 1000)) * 10) / 10, p95_ms: Math.round(percentile(b, 95) * 100) / 100 }; }),
    };
    phases.push(row);
    console.error(`  soak: ${row.ops_per_sec} ops/s over ${soakSec}s, p95 ${row.p95_ms}ms, errors ${errors}`);
  }

  function writeResult() {
    const result = {
      label, base, scale,
      started_at: new Date(t0).toISOString(),
      bootstrap_ms: bootstrapMs,
      total_wall_ms: Date.now() - t0,
      driver: `node ${process.version}`,
      phases,
    };
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
    console.error(`wrote ${outPath} (${Math.round((Date.now() - t0) / 1000)}s wall)`);
  }

  // Phase: schema apply (REST), both collections in one call, then re-apply
  // with a field change to measure schema mutation, then schema reads.
  await phase('schema_apply', N(10), async (i) => {
    const long = structuredClone(LONG_SCHEMA);
    if (i % 2 === 1) long.fields.push({ name: 'extra', label: 'Extra', type: 'text' });
    const res = await api(`/api/v1/${project}/schema`, {
      method: 'POST',
      write: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collections: [SHORT_SCHEMA, long] }),
    });
    expectStatus(res, 200);
  });
  await phase('schema_read', N(50), async () => {
    expectStatus(await api(`/api/v1/${project}/schema`), 200);
  });

  // Writes: individual creates, short vs long schema.
  const shortSlugs = [];
  await phase('create_short', N(300), async (i) => {
    const r = await mcp('create_entry', { collection: 'short-posts', slug: `short-${i}`, data: shortData(i), publish: true });
    shortSlugs.push(r.slug || `short-${i}`);
  });
  const longSlugs = [];
  await phase('create_long', N(150), async (i) => {
    const r = await mcp('create_entry', { collection: 'long-articles', slug: `long-${i}`, data: longData(i), publish: true });
    longSlugs.push(r.slug || `long-${i}`);
  });

  // Same create_entry write, but over the generic REST /call endpoint instead
  // of MCP JSON-RPC. Confirms the REST transport carries no extra per-write
  // cost over the MCP path (both dispatch through the same callTool + handler).
  await phase('create_short_restcall', N(300), async (i) => {
    const r = await restCall('create_entry', { collection: 'short-posts', slug: `restcall-${i}`, data: shortData(i), publish: true });
    shortSlugs.push(r.slug || `restcall-${i}`);
  });

  // Batch import path (one transaction per call, 200 per batch).
  await phase('batch_create_short_x200', N(3), async (b) => {
    const entries = Array.from({ length: 200 }, (_, j) => ({ slug: `batch-${b}-${j}`, data: shortData(j) }));
    await mcp('batch_create_entries', { collection: 'short-posts', entries, publish: true });
  });

  if (soakSec > 0) {
    await runSoak(shortSlugs);
    if (soakOnly) return writeResult();
  }

  // Reads: list (short list now holds ~900 published entries), single, ETag.
  await phase('read_list_short', N(200), async () => {
    expectStatus(await api(`/api/v1/${project}/short-posts`), 200);
  });
  // v0.23.0: limit/offset clamping on the list path (negative/huge cannot break SQL).
  await phase('read_list_clamped', N(200), async () => {
    expectStatus(await api(`/api/v1/${project}/short-posts?limit=-5&offset=-10`), 200);
  });
  // v0.23.0: bare ISO updated_since without a zone is UTC, not server-local.
  await phase('read_updated_since_bare', N(200), async () => {
    expectStatus(await api(`/api/v1/${project}/short-posts?updated_since=2000-01-01T00:00:00`), 200);
  });
  await phase('read_list_long', N(100), async () => {
    expectStatus(await api(`/api/v1/${project}/long-articles`), 200);
  });
  await phase('read_single_short', N(400), async (i) => {
    expectStatus(await api(`/api/v1/${project}/short-posts/${shortSlugs[i % shortSlugs.length]}`), 200);
  });
  await phase('read_single_long', N(200), async (i) => {
    expectStatus(await api(`/api/v1/${project}/long-articles/${longSlugs[i % longSlugs.length]}`), 200);
  });
  const etagRes = await api(`/api/v1/${project}/short-posts`);
  const etag = etagRes.headers.get('etag');
  await phase('read_304_etag', N(300), async () => {
    expectStatus(await api(`/api/v1/${project}/short-posts`, { headers: { 'If-None-Match': etag } }), 304, 200);
  });

  // Update then immediately read back through the public API; asserts the
  // republished value is visible (write -> materialize -> read roundtrip).
  await phase('update_then_read', N(150), async (i) => {
    const slug = shortSlugs[i % shortSlugs.length];
    const marker = `updated-${i}-${randomBytes(4).toString('hex')}`;
    await mcp('update_entry', { collection: 'short-posts', slug, data: { title: marker }, publish: true });
    const got = await (await api(`/api/v1/${project}/short-posts/${slug}`)).json();
    if (got.title !== marker) throw new Error('read-after-update returned stale data');
  });
  // v0.23.0: list ETag folds max(updated_at); republish must flip it even with preserve_timestamps.
  await phase('etag_republish_preserve', N(30), async (i) => {
    const slug = shortSlugs[i % shortSlugs.length];
    const before = (await api(`/api/v1/${project}/short-posts`)).headers.get('etag');
    await mcp('update_entry', {
      collection: 'short-posts',
      slug,
      data: { title: `preserve-${i}-${randomBytes(3).toString('hex')}` },
      publish: true,
      preserve_timestamps: true,
    });
    const after = (await api(`/api/v1/${project}/short-posts`)).headers.get('etag');
    if (!before || !after || before === after) throw new Error('etag unchanged after preserve_timestamps republish');
  });

  // Bulk cosmetic ref rewrite (.png -> .webp across every entry). The known
  // pain point: bulkRewriteRefs scans the whole entries table once per pair via
  // instr() (no index possible on a substring), so dry-run time grows linearly
  // with pair count. One pair is the baseline scan cost; the full map exposes
  // the O(entries x pairs) blowup that 504s behind Cloudflare's ~100s cap.
  // After the single-pass fix, the full-map time should collapse toward the
  // 1-pair time instead of being rewritePairs x larger.
  const rewriteMap = Array.from({ length: rewritePairs }, (_, k) => ({ old: assetPng(k), new: assetWebp(k) }));
  await phase('rewrite_dry_1pair', 1, async () => {
    const r = await mcp('bulk_rewrite_refs', { pairs: [rewriteMap[0]], dry_run: true });
    if (r.content_version_bumped) throw new Error('dry run must not bump content_version');
  });
  await phase(`rewrite_dry_${rewritePairs}pairs`, 1, async () => {
    await mcp('bulk_rewrite_refs', { pairs: rewriteMap, dry_run: true });
  });
  // One live run: the write path (2 UPDATEs/pair today) plus a single version
  // bump. Last, so the .webp rewrite does not disturb earlier read assertions.
  await phase(`rewrite_live_${rewritePairs}pairs`, 1, async () => {
    const r = await mcp('bulk_rewrite_refs', { pairs: rewriteMap, dry_run: false });
    if (!r.content_version_bumped) throw new Error('live run should bump content_version once');
  });

  // Media on the local disk backend (S3 out of scope, costs money).
  const mediaFiles = [];
  const payload = randomBytes(64 * 1024); // 64 KB per file
  await phase('media_upload_64kb', N(40), async (i) => {
    const { body, type } = multipart(`bench-${i}.bin`, payload);
    const res = await api(`/api/v1/${project}/media`, { method: 'POST', write: true, headers: { 'Content-Type': type }, body });
    expectStatus(res, 200);
    mediaFiles.push(await res.json());
  });
  // Grab the returned links and access them (public serve route).
  await phase('media_serve_64kb', N(200), async (i) => {
    const m = mediaFiles[i % mediaFiles.length];
    const res = expectStatus(await fetch(base + m.url), 200);
    await res.arrayBuffer();
  });
  // "Update" media: content-hash keys mean re-upload with new bytes = new
  // object; upload replacements, then delete the originals they replace.
  const replacements = [];
  await phase('media_reupload', N(20), async (i) => {
    const { body, type } = multipart(`bench-${i}.bin`, randomBytes(64 * 1024));
    const res = await api(`/api/v1/${project}/media`, { method: 'POST', write: true, headers: { 'Content-Type': type }, body });
    expectStatus(res, 200);
    replacements.push(await res.json());
  });
  await phase('media_delete', mediaFiles.length + replacements.length, async (i) => {
    const m = [...mediaFiles, ...replacements][i];
    expectStatus(await form('POST', `/admin/projects/${project}/media/${m.id}/delete`), 302);
  });

  // Grab entry links from a list response and access each one.
  const listJson = await (await api(`/api/v1/${project}/short-posts`)).json();
  const linkSlugs = listJson.items.slice(0, 100).map((it) => it.slug);
  await phase('link_access', linkSlugs.length, async (i) => {
    expectStatus(await api(`/api/v1/${project}/short-posts/${linkSlugs[i]}`), 200);
  });

  // Concurrency probe: 20 parallel readers, mixed single reads.
  await phase('read_concurrent_20', N(400), async (i) => {
    expectStatus(await api(`/api/v1/${project}/short-posts/${shortSlugs[i % shortSlugs.length]}`), 200);
  }, { concurrency: 20 });
  await phase('write_concurrent_10', N(100), async (i) => {
    await mcp('create_entry', { collection: 'short-posts', slug: `conc-${i}`, data: shortData(i), publish: true });
  }, { concurrency: 10 });

  // Scheduled publishing: future-dated entries stay hidden behind the read
  // gate, then flip live (and the list ETag flips) once their time passes.
  const schedSlugs = [];
  const future = new Date(Date.now() + 86400e3).toISOString();
  await phase('schedule_future', N(100), async (i) => {
    const slug = `sched-${i}`;
    await mcp('create_entry', { collection: 'short-posts', slug, data: shortData(i) });
    await mcp('publish_entry', { collection: 'short-posts', slug, at: future });
    schedSlugs.push(slug);
  });
  await phase('read_list_short_with_scheduled', N(200), async () => {
    const res = await api(`/api/v1/${project}/short-posts`);
    expectStatus(res, 200);
    const items = (await res.json()).items;
    if (items.some((it) => String(it.slug).startsWith('sched-'))) throw new Error('scheduled entry leaked into list');
  });
  await phase('read_single_scheduled_404', N(100), async (i) => {
    expectStatus(await api(`/api/v1/${project}/short-posts/${schedSlugs[i % schedSlugs.length]}`), 404);
  });
  await phase('list_scheduled', N(100), async () => {
    const rows = await mcp('list_scheduled', { collection: 'short-posts' });
    if (!rows.length || !rows.every((r) => r.publish_at)) throw new Error('list_scheduled returned no scheduled rows');
  });
  await phase('get_entry_draft_scheduled', N(100), async (i) => {
    const e = await mcp('get_entry', { collection: 'short-posts', slug: schedSlugs[i % schedSlugs.length], draft: true });
    if (e.status !== 'scheduled') throw new Error(`expected scheduled, got ${e.status}`);
  });
  await phase('reschedule_entry', N(100), async (i) => {
    const r = await mcp('publish_entry', { collection: 'short-posts', slug: schedSlugs[i % schedSlugs.length], at: future });
    if (r.status !== 'scheduled') throw new Error(`expected scheduled, got ${r.status}`);
  });
  const gateEtag = (await api(`/api/v1/${project}/short-posts`)).headers.get('etag');
  await phase('scheduled_goes_live', 1, async () => {
    const slug = 'sched-soon';
    await mcp('create_entry', { collection: 'short-posts', slug, data: shortData(0) });
    await mcp('publish_entry', { collection: 'short-posts', slug, at: new Date(Date.now() + 2000).toISOString() });
    const hiddenEtag = (await api(`/api/v1/${project}/short-posts`)).headers.get('etag');
    expectStatus(await api(`/api/v1/${project}/short-posts/${slug}`), 404);
    await new Promise((r) => setTimeout(r, 3100));
    expectStatus(await api(`/api/v1/${project}/short-posts/${slug}`), 200);
    const liveRes = await api(`/api/v1/${project}/short-posts`, { headers: { 'If-None-Match': hiddenEtag } });
    expectStatus(liveRes, 200); // ETag flipped without any write
    if (liveRes.headers.get('etag') === hiddenEtag) throw new Error('etag did not flip when entry went live');
  });
  void gateEtag;

  // ---- Production-like "misc" collection: every field type incl. a counter ----
  // Traffic shapes: read-only, read+write mix, write-only (votes, entry edits),
  // and a hot entry taking concentrated votes. Votes come from a large pool of
  // distinct visitors (IP via X-Forwarded-For, needs TRUST_PROXY=1, plus a UA)
  // with some repeats, like real traffic.
  const MISC_SCHEMA = {
    slug: 'misc',
    name: 'Misc',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'body', label: 'Body', type: 'markdown' },
      { name: 'views', label: 'Views', type: 'number' },
      { name: 'featured', label: 'Featured', type: 'boolean' },
      { name: 'day', label: 'Day', type: 'date' },
      { name: 'at', label: 'At', type: 'datetime' },
      { name: 'meta', label: 'Meta', type: 'json' },
      { name: 'cover', label: 'Cover', type: 'image' },
      { name: 'related', label: 'Related', type: 'relation', collection: 'short-posts' },
      { name: 'likes', label: 'Likes', type: 'counter' },
      { name: 'stars', label: 'Stars', type: 'counter', access: 'key' },
    ],
  };
  expectStatus(await api(`/api/v1/${project}/schema`, { method: 'POST', write: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collections: [MISC_SCHEMA] }) }), 200);
  const miscData = (i) => ({
    title: `Misc ${i}`,
    body: `# Heading ${i}\n\n${'Lorem ipsum dolor sit amet. '.repeat(40)}`,
    views: i,
    featured: i % 3 === 0,
    day: '2026-09-20',
    at: '2026-09-20T10:00:00Z',
    meta: { tags: ['a', 'b', `t${i}`], nested: { n: i } },
    cover: `https://cdn.example.com/misc/${i}.webp`,
    related: shortSlugs[i % shortSlugs.length] ?? '',
  });
  const miscSlugs = [];
  await phase('misc_seed', N(200), async (i) => {
    const r = await mcp('create_entry', { collection: 'misc', slug: `misc-${i}`, data: miscData(i), publish: true });
    miscSlugs.push(r.slug || `misc-${i}`);
  });
  const VOTERS = 50000;
  const rnd = (n) => Math.floor(Math.random() * n);
  const vote = async (slug, voter, dir = 'up', field = 'likes') => {
    const res = await fetch(`${base}/api/v1/${project}/misc/${slug}/counters/${field}?dir=${dir}`, {
      method: 'POST',
      headers: { 'X-Forwarded-For': `10.${(voter >> 16) & 255}.${(voter >> 8) & 255}.${voter & 255}`, 'User-Agent': `bench-ua-${voter % 97}` },
    });
    expectStatus(res, 200);
  };
  const miscSingle = async (i) => expectStatus(await api(`/api/v1/${project}/misc/${miscSlugs[rnd(miscSlugs.length)]}`), 200);
  const miscList = async () => expectStatus(await api(`/api/v1/${project}/misc?limit=20&offset=${rnd(10) * 20}`), 200);
  const miscCounts = async () => {
    const some = Array.from({ length: 20 }, () => miscSlugs[rnd(miscSlugs.length)]).join(',');
    expectStatus(await fetch(`${base}/api/v1/${project}/misc/counters?slugs=${some}`), 200);
  };
  const miscEdit = async (i) => {
    await mcp('update_entry', { collection: 'misc', slug: miscSlugs[rnd(miscSlugs.length)], data: { views: i }, publish: true });
  };
  const miscVote = async () => vote(miscSlugs[rnd(miscSlugs.length)], rnd(VOTERS), Math.random() < 0.85 ? 'up' : 'down');

  // Read only: 60% single, 15% list, 20% counter batch, 5% list revalidation.
  const miscEtag = (await api(`/api/v1/${project}/misc?limit=20&offset=0`)).headers.get('etag');
  await phase('misc_read_only', N(1500), async (i) => {
    const m = i % 20;
    if (m < 12) return miscSingle(i);
    if (m < 15) return miscList();
    if (m < 19) return miscCounts();
    expectStatus(await api(`/api/v1/${project}/misc?limit=20&offset=0`, { headers: { 'If-None-Match': miscEtag } }), 304, 200);
  }, { concurrency: 16 });
  // Read + write: 50% single, 10% list, 10% counter batch, 25% votes, 5% entry edits.
  await phase('misc_read_write', N(1500), async (i) => {
    const m = i % 20;
    if (m < 10) return miscSingle(i);
    if (m < 12) return miscList();
    if (m < 14) return miscCounts();
    if (m < 19) return miscVote();
    return miscEdit(i);
  }, { concurrency: 16 });
  // Write only, votes: distinct visitors across all entries.
  await phase('misc_write_votes', N(3000), () => miscVote(), { concurrency: 32 });
  // Write only, entry edits (MCP update + publish, the CMS write path).
  await phase('misc_write_edits', N(200), (i) => miscEdit(i), { concurrency: 4 });
  // Concentrated: one hot entry. Pure votes, then votes with 30% reads of it.
  const hot = miscSlugs[0];
  await phase('misc_hot_votes', N(5000), () => vote(hot, rnd(VOTERS), Math.random() < 0.8 ? 'up' : 'down'), { concurrency: 64 });
  await phase('misc_hot_mixed', N(3000), async (i) => {
    if (i % 10 < 3) expectStatus(await fetch(`${base}/api/v1/${project}/misc/${hot}/counters`), 200);
    else await vote(hot, rnd(VOTERS));
  }, { concurrency: 64 });
  // Repeat voters: 200 visitors hammering the same entry (dedupe path, mostly no-ops).
  await phase('misc_hot_repeat_voters', N(3000), () => vote(hot, rnd(200), 'up'), { concurrency: 64 });
  // Private counter with a write key (no dedupe, arbitrary step).
  await phase('misc_private_bump', N(1000), async () => {
    expectStatus(await fetch(`${base}/api/v1/${project}/misc/${hot}/counters/stars?by=2`, { method: 'POST', headers: { Authorization: `Bearer ${writeKey}` } }), 200);
  }, { concurrency: 16 });

  // Countermap: added after the counter phases so their numbers stay comparable
  // with earlier versions. Keys: 16 plain reactions plus a 5-option poll group.
  await mcp('add_field', { collection: 'misc', label: 'Reactions', type: 'countermap', name: 'reactions' });
  const mapVote = async (slug, voter, key) => {
    const res = await fetch(`${base}/api/v1/${project}/misc/${slug}/counters/reactions/${key}`, {
      method: 'POST',
      headers: { 'X-Forwarded-For': `10.${(voter >> 16) & 255}.${(voter >> 8) & 255}.${voter & 255}`, 'User-Agent': `bench-ua-${voter % 97}` },
    });
    expectStatus(res, 200);
  };
  const mapKey = () => (Math.random() < 0.5 ? `r${rnd(16)}` : `poll:o${rnd(5)}`);
  // Hot entry, distinct visitors, mixed plain and group keys.
  await phase('misc_cmap_hot_votes', N(5000), () => mapVote(hot, rnd(VOTERS), mapKey()), { concurrency: 64 });
  // Group switch heavy: 200 visitors flipping between poll options (decrement + increment per vote).
  await phase('misc_cmap_group_switch', N(3000), () => mapVote(hot, rnd(200), `poll:o${rnd(5)}`), { concurrency: 64 });
  // Map reads: 70% the hot entry, 30% a 20-entry bulk read (cold maps load once each).
  await phase('misc_cmap_read', N(2000), async (i) => {
    if (i % 10 < 7) return expectStatus(await fetch(`${base}/api/v1/${project}/misc/${hot}/counters`), 200);
    return miscCounts();
  }, { concurrency: 32 });

  // Schema health scan: full entries-table read per collection with entries
  // (short-posts, long-articles, misc all seeded by now), field validation run
  // over every row. The one place check_schema_health's cost is worth watching.
  await phase('check_schema_health', N(20), async () => {
    await mcp('check_schema_health', {});
  });

  // Schema-impact guard cost: previewFieldChange runs a full entries scan on
  // every guarded write, so this is the perf-sensitive path the guard feature
  // added on top of existing schema endpoints. One large collection
  // (short-posts, ~900+ entries by now) and one small (long-articles, ~150)
  // so per-collection scan cost is visible, not just an aggregate number.
  await phase('guard_update_field_large', N(50), async () => {
    await mcp('update_field', { collection: 'short-posts', field: 'title', label: `Title ${Math.random()}` });
  });
  await phase('guard_update_field_small', N(50), async () => {
    await mcp('update_field', { collection: 'long-articles', field: 'title', label: `Title ${Math.random()}` });
  });
  await phase('guard_add_field_forced_large', N(20), async (i) => {
    await mcp('add_field', { collection: 'short-posts', label: `Bench Req ${i}`, type: 'text', required: true, force: true });
  });
  await phase('guard_add_field_forced_small', N(20), async (i) => {
    await mcp('add_field', { collection: 'long-articles', label: `Bench Req ${i}`, type: 'text', required: true, force: true });
  });

  // remove_field archives, restore_field runs the same guarded scan again on
  // the way back; full round trip on a throwaway field per iteration.
  await phase('field_archive_restore_cycle_large', N(20), async (i) => {
    const added = await mcp('add_field', { collection: 'short-posts', label: `Bench Cycle ${i}`, type: 'text' });
    await mcp('remove_field', { collection: 'short-posts', field: added.name });
    await mcp('restore_field', { collection: 'short-posts', field: added.name });
  });
  await phase('field_archive_restore_cycle_small', N(20), async (i) => {
    const added = await mcp('add_field', { collection: 'long-articles', label: `Bench Cycle ${i}`, type: 'text' });
    await mcp('remove_field', { collection: 'long-articles', field: added.name });
    await mcp('restore_field', { collection: 'long-articles', field: added.name });
  });

  // OpenAPI document: built once per (origin, rate limit), then served from memory.
  await phase('openapi_read', N(500), async () => {
    expectStatus(await api(`/api/v1/${project}/openapi.json`), 200);
  }, { concurrency: 8 });

  // Auth gate: every key-gated route must refuse a keyless or read-scope caller.
  // Counts as one request per probe; any 200 fails the run.
  const gated = [
    ['GET', 'schema'], ['GET', 'field-types'], ['GET', 'openapi.json'], ['GET', 'short-posts'], ['GET', `short-posts/${shortSlugs[0]}`],
    ['POST', 'schema'], ['POST', 'media'], ['POST', 'call/list_collections'], ['POST', 'import'], ['POST', 'rewrite-refs'], ['GET', 'export'],
    ['POST', `misc/${hot}/counters/stars?by=1`],
  ];
  await phase('auth_gate_probes', gated.length * N(20), async (i) => {
    const [method, path] = gated[i % gated.length];
    const url = `${base}/api/v1/${project}/${path}`;
    const none = await fetch(url, { method, body: method === 'POST' ? '{}' : undefined });
    if (![401, 404].includes(none.status)) throw new Error(`keyless ${method} ${path} returned ${none.status}`);
    const bad = await fetch(url, { method, headers: { Authorization: 'Bearer yn_wrong' }, body: method === 'POST' ? '{}' : undefined });
    if (![401, 404].includes(bad.status)) throw new Error(`bad-key ${method} ${path} returned ${bad.status}`);
    if (method === 'POST' && path !== 'call/list_collections') {
      const ro = await api(`/api/v1/${project}/${path}`, { method, body: '{}' });
      if (![403, 404, 400, 401].includes(ro.status)) throw new Error(`read key ${method} ${path} returned ${ro.status}`);
    }
  }, { concurrency: 8 });
  expectStatus(await fetch(`${base}/admin/projects/${project}/openapi.json`, { redirect: 'manual' }), 302, 401, 403);
  expectStatus(await fetch(`${base}/mcp/${project}`, { method: 'POST', body: '{}' }), 401);

  // Rate limits: off by default (no headers), on when a number is set, 429 past it, restored after.
  {
    const call = () => fetch(`${base}/api/v1/${project}/call/list_collections`, { method: 'POST', headers: { Authorization: `Bearer ${readKey}`, 'Content-Type': 'application/json' }, body: '{}' });
    expectStatus(await form('POST', `/admin/projects/${project}/rate-limit`, { rate_limit_per_min: '0', counter_ip_limit_per_min: '0' }), 302);
    const off = await call();
    if (off.headers.get('ratelimit-limit') !== null) throw new Error('limit should be off');
    expectStatus(await form('POST', `/admin/projects/${project}/rate-limit`, { rate_limit_per_min: '5', counter_ip_limit_per_min: '0' }), 302);
    let hit429 = 0;
    await phase('rate_limit_on', 20, async () => { if ((await call()).status === 429) hit429++; });
    if (!hit429) throw new Error('rate limit never returned 429');
    expectStatus(await form('POST', `/admin/projects/${project}/rate-limit`, { rate_limit_per_min: '100000000', counter_ip_limit_per_min: '0' }), 302);
  }

  // Deletes.
  await phase('delete_entries', N(200), async (i) => {
    await mcp('delete_entry', { collection: 'short-posts', slug: shortSlugs[i] });
  });

  // v0.23.0: admin login rate limit (per-IP, checked before password hash).
  cookie = null;
  await phase('login_rate_limit', 11, async (i) => {
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'bench@example.com', password: 'wrong-password' }).toString(),
    });
    const want = i < 10 ? 401 : 429;
    if (res.status !== want) throw new Error(`login attempt ${i + 1}: expected ${want}, got ${res.status}`);
  });

  writeResult();
}

main().catch((e) => {
  console.error(`bench failed: ${e.message}`);
  // Still write a failure record so the matrix stays honest.
  try {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ label, base, failed: e.message, phases }, null, 2) + '\n');
  } catch {}
  process.exit(1);
});
