// Renders bench/results/v*/ JSON files into one markdown summary.
// Usage: node bench/summarize.mjs bench/results/v0.11.0 > summary.md
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node bench/summarize.mjs <results-dir>');
  process.exit(2);
}

const runs = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')))
  .sort((a, b) => (a.label || '').localeCompare(b.label || ''));

const ok = runs.filter((r) => !r.failed);
const failed = runs.filter((r) => r.failed);
const version = ok[0]?.cms_version || path.basename(dir).replace(/^v/, '');

console.log(`# Boring CMS benchmark v${version}`);
console.log('');
console.log(`Run: ${ok[0]?.started_at || 'n/a'} on ${os.type()} ${os.release()}, ${os.cpus()[0]?.model || 'unknown CPU'} (${os.cpus().length} cores host).`);
console.log('Constraints and methodology: see bench/README.md. Read it before comparing numbers; the CPU pinning, memory caps, rate limit override, and client placement all shape these results.');
console.log('');

if (failed.length) {
  console.log('## Failed runs');
  console.log('');
  for (const r of failed) console.log(`- ${r.label}: ${r.failed}`);
  console.log('');
}

// One table per phase, runs as columns (ops/s and p95).
const phaseNames = [...new Set(ok.flatMap((r) => r.phases.map((p) => p.name)))];
console.log('## Throughput (ops/s) by phase');
console.log('');
console.log(`| Phase | ${ok.map((r) => r.label).join(' | ')} |`);
console.log(`| --- | ${ok.map(() => '---:').join(' | ')} |`);
for (const name of phaseNames) {
  const cells = ok.map((r) => {
    const p = r.phases.find((x) => x.name === name);
    return p ? `${p.ops_per_sec}${p.errors ? ` (${p.errors} err)` : ''}` : 'n/a';
  });
  console.log(`| ${name} | ${cells.join(' | ')} |`);
}
console.log('');
console.log('## Latency p50 / p95 (ms) by phase');
console.log('');
console.log(`| Phase | ${ok.map((r) => r.label).join(' | ')} |`);
console.log(`| --- | ${ok.map(() => '---:').join(' | ')} |`);
for (const name of phaseNames) {
  const cells = ok.map((r) => {
    const p = r.phases.find((x) => x.name === name);
    return p ? `${p.p50_ms} / ${p.p95_ms}` : 'n/a';
  });
  console.log(`| ${name} | ${cells.join(' | ')} |`);
}
console.log('');
console.log('## Run metadata');
console.log('');
console.log('| Run | Runtime | vCPUs | Peak RSS (MB) | Wall (s) |');
console.log('| --- | --- | ---: | ---: | ---: |');
for (const r of ok) {
  console.log(`| ${r.label} | ${r.runtime_version || r.runtime} | ${r.vcpus} | ${r.server_peak_rss_mb ?? 'n/a'} | ${Math.round((r.total_wall_ms || 0) / 1000)} |`);
}
