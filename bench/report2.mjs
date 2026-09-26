// Renders the whole bench/results-v2/ history into one static HTML report:
// per-phase ops/s across every benchmarked version, deltas, changelog context
// per version, and the reasons bench v2 replaced v1 for trend reading.
// Usage: node bench/report2.mjs   (writes bench/results-v2/report.html)
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const base = path.join(root, 'bench', 'results-v2');

// ---- load history ---------------------------------------------------------

const semver = (v) => v.replace(/^v/, '').split('.').map(Number);
const cmp = (a, b) => {
  const [x, y] = [semver(a), semver(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

const versions = readdirSync(base)
  .filter((d) => /^v\d+\.\d+\.\d+$/.test(d))
  .sort(cmp);
if (!versions.length) {
  console.error('no results in', base);
  process.exit(2);
}

// runs[version][label] = parsed json
const runs = {};
const labels = new Set();
for (const v of versions) {
  runs[v] = {};
  for (const f of readdirSync(path.join(base, v))) {
    if (!f.endsWith('.json') || f === 'toolchain.json') continue;
    const j = JSON.parse(readFileSync(path.join(base, v, f), 'utf8'));
    if (!j.phases) continue;
    runs[v][j.label] = j;
    labels.add(j.label);
  }
}

// ---- changelog ------------------------------------------------------------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

const changelog = {};
const clPath = path.join(root, 'CHANGELOG.md');
if (existsSync(clPath)) {
  for (const section of readFileSync(clPath, 'utf8').split(/^## /m).slice(1)) {
    const m = section.match(/^(\d+\.\d+\.\d+)/);
    if (!m) continue;
    changelog['v' + m[1]] = section
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => md(l.slice(2)));
  }
}

// ---- table rows per label -------------------------------------------------

const fmt = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));
const groupOf = (name) => {
  if (name.startsWith('field_')) return 'Field: ' + name.split('_')[1];
  if (name.startsWith('core_')) return 'Core API and media';
  return 'Schema';
};

function tableFor(label) {
  const vs = versions.filter((v) => runs[v][label]);
  if (!vs.length) return '';
  const latest = runs[vs[vs.length - 1]][label];
  let html = `<h2>${esc(label)}</h2><div class="tblwrap"><table><thead><tr><th>Phase</th>`;
  html += vs.map((v) => `<th class="num">${esc(v)}</th>`).join('');
  html += '<th class="num">&Delta;</th><th>Trend</th></tr></thead><tbody>';
  let group = null;
  for (const p of latest.phases) {
    const g = groupOf(p.name);
    if (g !== group) {
      group = g;
      html += `<tr class="grp"><td colspan="${vs.length + 3}">${esc(g)}</td></tr>`;
    }
    const ops = vs.map((v) => runs[v][label].phases.find((x) => x.name === p.name)?.ops_per_sec ?? null);
    const have = ops.filter((x) => x != null);
    const max = Math.max(...have);
    const last = ops[ops.length - 1];
    const prev = ops.length > 1 ? ops[ops.length - 2] : null;
    const d = last != null && prev != null ? ((last - prev) / prev) * 100 : null;
    const cls = d == null || Math.abs(d) < 5 ? 'flat' : d > 0 ? 'up' : 'down';
    const dtxt = d == null ? '–' : (d > 0 ? '+' : '') + d.toFixed(1) + '%';
    const bars = ops
      .map((x) => (x == null ? '<i class="na"></i>' : `<i style="height:${Math.max(2, Math.round((x / max) * 16))}px"></i>`))
      .join('');
    html += `<tr><td class="phase">${esc(p.name)}</td>`;
    html += ops.map((x, i) => `<td class="num${i === ops.length - 1 ? ' cur' : ''}">${fmt(x)}</td>`).join('');
    html += `<td class="num"><span class="${cls}">${dtxt}</span></td><td><span class="bars">${bars}</span></td></tr>`;
  }
  html += '</tbody></table></div>';
  const rss = vs.map((v) => `${v} ${runs[v][label].server_peak_rss_mb ?? '?'}MB`).join(' &middot; ');
  html += `<p class="note">Peak server RSS: ${rss}. &Delta; is the last version against the one before it; swings under 5% are grey (session noise).</p>`;
  return html;
}

// ---- changelog section ----------------------------------------------------

let clHtml = '';
for (const v of [...versions].reverse()) {
  const items = changelog[v];
  clHtml += `<details${v === versions[versions.length - 1] ? ' open' : ''}><summary>${esc(v)}</summary>`;
  clHtml += items?.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '<p class="note">No changelog entry.</p>';
  clHtml += '</details>';
}

// ---- page -----------------------------------------------------------------

const latestV = versions[versions.length - 1];
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Boring CMS Bench2 ${esc(latestV)}</title>
<style>
:root{
  --bg:#fcfcfb; --ink:#1e1e1c; --muted:#6b6b66; --border:#e5e4e0; --band:#f4f3f0;
  --blue:#2a78d6; --aqua:#1baf7a; --red:#c23b2a;
  --sans:"IBM Plex Sans",system-ui,sans-serif; --mono:"IBM Plex Mono",ui-monospace,monospace;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#1a1a19; --ink:#e8e7e3; --muted:#9a9994; --border:#33322f; --band:#222220;
    --blue:#3987e5; --aqua:#199e70; --red:#d95949;
    color-scheme:dark;
  }
}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);margin:0;padding:0 16px}
.wrap{max-width:1100px;margin:0 auto;padding-block:40px 64px}
h1{font-size:1.5rem;font-weight:600;margin:0 0 4px}
h2{font-size:1.05rem;font-weight:600;margin:44px 0 8px;font-family:var(--mono)}
h3{font-size:.95rem;font-weight:600;margin:28px 0 6px}
.sub{color:var(--muted);margin:0 0 8px;font-size:.92rem}
p,li{max-width:74ch;line-height:1.55}
.note{color:var(--muted);font-size:.85rem}
code{font-family:var(--mono);font-size:.88em;background:var(--band);padding:1px 5px;border-radius:3px}
.tblwrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.85rem}
th{text-align:left;font-weight:500;color:var(--muted);padding:6px 10px;border-bottom:1px solid var(--border);white-space:nowrap}
th.num,td.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums}
td{padding:5px 10px;white-space:nowrap}
tbody tr:nth-child(even){background:var(--band)}
td.phase{font-family:var(--mono);font-size:.8rem}
tr.grp td{background:var(--bg);color:var(--muted);font-size:.72rem;letter-spacing:.05em;text-transform:uppercase;padding-top:18px;border-bottom:1px solid var(--border)}
td.cur{font-weight:600}
.up{color:var(--aqua)} .down{color:var(--red)} .flat{color:var(--muted)}
.bars{display:inline-flex;gap:2px;align-items:flex-end;height:16px;vertical-align:middle}
.bars i{width:5px;background:var(--blue);opacity:.35;border-radius:1px}
.bars i:last-child{opacity:1}
.bars i.na{background:var(--border);height:2px!important}
details{border-top:1px solid var(--border);padding:8px 0}
summary{cursor:pointer;font-family:var(--mono);font-size:.9rem;padding:4px 0}
footer{margin-top:56px;color:var(--muted);font-size:.8rem;border-top:1px solid var(--border);padding-top:14px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Boring CMS Bench2</h1>
  <p class="sub">Cross-version throughput history, ${esc(versions[0])} through ${esc(latestV)}. Generated by <code>bench/report2.mjs</code> from <code>bench/results-v2/</code>.</p>

  ${[...labels].sort().map(tableFor).join('')}

  <h2>What changed in each version</h2>
  <p class="note">From CHANGELOG.md, so a number swing can be read next to the change that could explain it.</p>
  ${clHtml}

  <h2>Why bench v2 replaced v1 for trend reading</h2>
  <p>The v1 matrix (<code>bench/run.sh</code>) stays frozen for comparability with old results, but it is no longer how trends are judged, because it misled us once: the committed v0.24.0 numbers showed a board-wide dip that looked like a counter regression and was really one noisy session.</p>
  <ul>
    <li><b>Too short to trust.</b> A full v1 combo finishes in about 10 seconds of wall time, so one background hiccup moves every phase 10&ndash;25%. v2 phases are 4&ndash;6x longer (about 18&ndash;20s per combo), which pushed session noise down to a few percent.</li>
    <li><b>No per-field isolation.</b> v1 mixes field types inside shared phases, so "counter got slower" and "everything got slower" look identical. v2 gives every field type its own write and read phase, plus dedicated vote phases for counter and countermap, so a regression names its culprit.</li>
    <li><b>Manual coverage.</b> v1 phases are hand-written; a new field type ships unbenchmarked until someone remembers. v2 asks the server for its field types (<code>GET /api/v1/&lt;project&gt;/field-types</code>) and generates the phases, so new types are covered with zero driver changes.</li>
    <li><b>No history.</b> v1 results only exist for the version that ran them. v2 drives any older checkout via <code>--src</code> git worktrees with one fixed driver, so every version's numbers come from identical load and are comparable.</li>
  </ul>

  <footer>node, taskset-pinned CPUs, fresh data dir per run. Raw JSON per version in <code>bench/results-v2/&lt;version&gt;/</code>. Regenerate with <code>node bench/report2.mjs</code>.</footer>
</div>
</body>
</html>
`;

const out = path.join(base, 'report.html');
writeFileSync(out, page);
console.log('wrote', path.relative(root, out), `(${versions.length} versions, labels: ${[...labels].sort().join(', ')})`);
