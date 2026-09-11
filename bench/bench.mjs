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
// instr() scan on the current code, so this is the dimension that blows up in
// prod (2216 pairs -> 2216 scans -> gateway timeout). Kept small by default so
// the bench finishes; crank it (and --scale) to approach prod pain locally.
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
// nothing but still cost a full scan, exactly like the prod 2216-pair map.
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

  // Reads: list (short list now holds ~900 published entries), single, ETag.
  await phase('read_list_short', N(200), async () => {
    expectStatus(await api(`/api/v1/${project}/short-posts`), 200);
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

  // Bulk cosmetic ref rewrite (.png -> .webp across every entry). The prod
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

  // Deletes.
  await phase('delete_entries', N(200), async (i) => {
    await mcp('delete_entry', { collection: 'short-posts', slug: shortSlugs[i] });
  });

  const result = {
    label,
    base,
    scale,
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

main().catch((e) => {
  console.error(`bench failed: ${e.message}`);
  // Still write a failure record so the matrix stays honest.
  try {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ label, base, failed: e.message, phases }, null, 2) + '\n');
  } catch {}
  process.exit(1);
});
