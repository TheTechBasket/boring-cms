// Cross-version benchmark trend: reads every bench/results/v*/<combo>.json and
// renders how ops/s moved release to release, phase by phase, across every
// runtime/vCPU combo that was actually run. Emits a markdown table (one combo,
// for quick terminal reading) and one consolidated, filterable HTML report
// covering all combos.
// Usage: node bench/trend.mjs [combo]   (combo picks the markdown table; default node-1cpu)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mdCombo = process.argv[2] || 'node-1cpu';
const resultsDir = path.join(import.meta.dirname, 'results');

// Counter/vote traffic (misc_* phases) is bursty, high-volume, cheap-per-op
// mixed load that doesn't represent the rest of the CMS surface. Left inside
// an "overall speed" average it swings the number in ways unrelated to
// everything else getting faster or slower, so report it separately.
const isCounterPhase = (name) => name.startsWith('misc_');

const geoMean = (nums) => {
  const xs = nums.filter((n) => typeof n === 'number' && n > 0);
  if (!xs.length) return null;
  return Math.exp(xs.reduce((s, n) => s + Math.log(n), 0) / xs.length);
};

const versionDirs = readdirSync(resultsDir)
  .filter((d) => /^v\d/.test(d))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

// Discover every combo (e.g. "node-1cpu") actually present anywhere in the history.
const comboNames = [...new Set(
  versionDirs.flatMap((dir) => readdirSync(path.join(resultsDir, dir))
    .map((f) => f.match(/^((?:node|bun|deno)-\d+cpu)\.json$/)?.[1])
    .filter(Boolean))
)].sort();

const round = (v) => (v == null ? null : v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
const opsFor = (run, name) => round(run.phases.find((p) => p.name === name)?.ops_per_sec ?? null);

function loadRuns(combo) {
  const runs = [];
  for (const dir of versionDirs) {
    const file = path.join(resultsDir, dir, `${combo}.json`);
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data.phases) runs.push(data);
    } catch {
      // combo not run for this version
    }
  }
  return runs;
}

function buildChartData(combo) {
  const runs = loadRuns(combo);
  if (!runs.length) return null;
  const phaseSets = runs.map((r) => new Set(r.phases.map((p) => p.name)));
  const baselinePhases = [...phaseSets[0]].filter((name) => phaseSets.every((s) => s.has(name)));
  const allPhaseNames = [...new Set(runs.flatMap((r) => r.phases.map((p) => p.name)))];
  return {
    combo,
    versions: runs.map((r) => r.cms_version),
    overall: runs.map((run) => {
      const runPhaseNames = run.phases.map((p) => p.name);
      return {
        all: geoMean(runPhaseNames.map((n) => opsFor(run, n))),
        withoutCounter: geoMean(runPhaseNames.filter((n) => !isCounterPhase(n)).map((n) => opsFor(run, n))),
        baseline: geoMean(baselinePhases.map((n) => opsFor(run, n))),
        hasCounter: runPhaseNames.some(isCounterPhase),
      };
    }),
    baselineCount: baselinePhases.length,
    phases: allPhaseNames.map((name) => ({
      name,
      counter: isCounterPhase(name),
      ops: runs.map((r) => opsFor(r, name)),
    })),
  };
}

// ---- Markdown (single combo, for terminal reading) ----
const mdRuns = loadRuns(mdCombo);
if (mdRuns.length) {
  const chartData = buildChartData(mdCombo);
  const lines = [];
  lines.push(`# Boring CMS benchmark trend (${mdCombo})`);
  lines.push('');
  lines.push(`Versions: ${chartData.versions.join(', ')}`);
  lines.push('Methodology and constraints: see bench/README.md. Full interactive report with runtime/vCPU/counter filters: bench/results/report.html.');
  lines.push('');
  lines.push('## Overall speed (ops/s, geometric mean, higher is better)');
  lines.push('');
  lines.push(`| Version | All phases | Without counter phases | Baseline (common to all versions) |`);
  lines.push(`| --- | ---: | ---: | ---: |`);
  chartData.versions.forEach((v, i) => {
    const o = chartData.overall[i];
    const withoutCounterCell = o.withoutCounter == null ? 'n/a' : o.hasCounter ? Math.round(o.withoutCounter) : `${Math.round(o.withoutCounter)} (no counter phases yet, same as "all")`;
    lines.push(`| ${v} | ${o.all ? Math.round(o.all) : 'n/a'} | ${withoutCounterCell} | ${o.baseline ? Math.round(o.baseline) : 'n/a'} |`);
  });
  lines.push('');
  lines.push('## Throughput (ops/s) by phase, across versions (higher is better)');
  lines.push('');
  lines.push(`| Phase | ${chartData.versions.join(' | ')} |`);
  lines.push(`| --- | ${chartData.versions.map(() => '---:').join(' | ')} |`);
  for (const p of chartData.phases) {
    const tag = p.counter ? ' (counter)' : '';
    lines.push(`| ${p.name}${tag} | ${p.ops.map((v) => v == null ? 'n/a' : v).join(' | ')} |`);
  }
  lines.push('');
  const out = lines.join('\n') + '\n';
  process.stdout.write(out);
  writeFileSync(path.join(resultsDir, `trend-${mdCombo}.md`), out);
} else {
  console.error(`no ${mdCombo}.json runs found under ${resultsDir}/v*/, skipping markdown`);
}

// ---- Consolidated HTML report: every combo, filterable by runtime/vCPU, counter toggle ----
const combosData = {};
for (const combo of comboNames) {
  const d = buildChartData(combo);
  if (d) combosData[combo] = d;
}
const runtimes = [...new Set(comboNames.map((c) => c.split('-')[0]))];
const vcpuOptions = [...new Set(comboNames.map((c) => c.match(/-(\d+)cpu$/)[1]))].sort((a, b) => a - b);

// Parse CHANGELOG.md into { version: { date, bullets } }, keyed on the same
// "X.Y.Z" string bench results carry as cms_version.
const changelogPath = path.join(import.meta.dirname, '..', 'CHANGELOG.md');
const changelog = {};
try {
  const raw = readFileSync(changelogPath, 'utf8');
  const sections = raw.split(/^## /m).slice(1);
  for (const section of sections) {
    const m = section.match(/^(\d+\.\d+\.\d+)\s*\(([^)]+)\)\n([\s\S]*)$/);
    if (!m) continue;
    const [, version, date, body] = m;
    const bullets = [...body.matchAll(/^- (.+)$/gm)].map((b) => b[1]);
    changelog[version] = { date, bullets };
  }
} catch {
  // no CHANGELOG.md next to bench/, skip
}
const versionList = versionDirs.map((d) => d.replace(/^v/, ''));

const html = `<!doctype html>
<title>Boring CMS bench trend</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root {
  --bg: #fcfcfb; --surface: #f4f4f2; --ink: #0b0b0b; --ink-2: #52514e;
  --line: #e2e1dd; --band: rgba(11, 11, 11, 0.035);
  --s-all: #2a78d6; --s-nocounter: #1baf7a; --s-baseline: #52514e; --s-counter-row: #eb6834;
  --grid: #e8e7e3;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1a1a19; --surface: #232322; --ink: #ffffff; --ink-2: #c3c2b7;
    --line: #3a3936; --band: rgba(255, 255, 255, 0.045);
    --s-all: #3987e5; --s-nocounter: #2fd18f; --s-baseline: #c3c2b7; --s-counter-row: #d95926;
    --grid: #2e2d2b;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: "IBM Plex Sans", sans-serif; font-size: 14px; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 80px; }
h1 { font-size: 20px; margin: 0 0 4px; }
p.sub { color: var(--ink-2); margin: 0 0 20px; max-width: 74ch; }
.controls { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; margin: 0 0 14px; font-family: "IBM Plex Mono", monospace; font-size: 12.5px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.seg button { font: 500 12.5px "IBM Plex Mono", monospace; background: none; border: none; color: var(--ink-2); padding: 5px 12px; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--line); }
.seg button[aria-pressed="true"] { background: var(--ink); color: var(--bg); }
.controls label.check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--ink-2); }
.legend { display: flex; gap: 18px; font-family: "IBM Plex Mono", monospace; font-size: 12px; color: var(--ink-2); margin-bottom: 8px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
canvas { width: 100%; height: 340px; display: block; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
.empty { padding: 60px 0; text-align: center; color: var(--ink-2); font-family: "IBM Plex Mono", monospace; }
table { width: 100%; border-collapse: collapse; font-family: "IBM Plex Mono", monospace; font-size: 12.5px; margin-top: 28px; }
th, td { padding: 5px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
thead th { color: var(--ink-2); font-weight: 500; position: sticky; top: 0; background: var(--bg); }
tr.counter td:first-child { color: var(--s-counter-row); }
tr.counter.hidden { display: none; }
tbody tr:hover { background: var(--band); }
.wrap { overflow-x: auto; }
h2 { font-size: 15px; margin: 32px 0 4px; }
.meta { color: var(--ink-2); font-size: 12px; margin: 4px 0 0; font-family: "IBM Plex Mono", monospace; }
#tip {
  position: fixed; z-index: 10; pointer-events: none; display: none;
  background: var(--bg); border: 1px solid var(--line); border-radius: 6px;
  padding: 8px 10px; box-shadow: 0 6px 18px rgba(0,0,0,0.12);
  font-family: "IBM Plex Mono", monospace; font-size: 11.5px; color: var(--ink-2);
}
#tip b { color: var(--ink); font-weight: 600; }
#tip canvas { width: 200px; height: 48px; border: none; background: none; margin-top: 4px; }
.changelog details { border-bottom: 1px solid var(--line); padding: 8px 0; }
.changelog summary { cursor: pointer; font-family: "IBM Plex Mono", monospace; font-size: 12.5px; }
.changelog summary b { color: var(--ink); }
.changelog summary span { color: var(--ink-2); margin-left: 8px; }
.changelog ul { margin: 8px 0 4px; padding-left: 20px; }
.changelog li { margin: 0 0 6px; font-size: 13px; line-height: 1.45; }
</style>
<main>
  <h1>Boring CMS benchmark trend</h1>
  <p class="sub">Geometric mean of ops/s across phases, per release. Higher is better throughout: chart, table, everything on this page. "All phases" includes counter/vote traffic (misc_*); "without counter" strips it out since it's high-volume and cheap-per-op, unrepresentative of the rest of the CMS surface. "Baseline" is the subset of phases present in every version this combo has data for, for a same-shape comparison across history.</p>

  <div class="controls">
    <div class="seg" id="runtimeSeg"></div>
    <div class="seg" id="vcpuSeg"></div>
    <label class="check"><input type="checkbox" id="hideCounterRows"> hide counter rows in table</label>
  </div>

  <div class="legend">
    <span><i style="background:var(--s-all)"></i>all phases</span>
    <span><i style="background:var(--s-nocounter)"></i>without counter</span>
    <span><i style="background:var(--s-baseline)"></i>baseline</span>
  </div>
  <canvas id="chart" width="1100" height="340"></canvas>
  <p class="meta">Hover the chart to see exact values for a version.</p>
  <p class="meta" id="meta"></p>

  <h2>Per-phase throughput (ops/s, higher is better)</h2>
  <p class="meta">Hover a row to see that phase's own trend across versions.</p>
  <div class="wrap">
    <table id="phaseTable"></table>
  </div>

  <h2>Changelog</h2>
  <div class="changelog" id="changelog"></div>
</main>
<div id="tip"><b id="tipTitle"></b><canvas id="tipCanvas" width="200" height="48"></canvas></div>
<script>
const COMBOS = ${JSON.stringify(combosData)};
const RUNTIMES = ${JSON.stringify(runtimes)};
const VCPUS = ${JSON.stringify(vcpuOptions)};
const CHANGELOG = ${JSON.stringify(changelog)};
const VERSIONS = ${JSON.stringify(versionList)};

let runtime = RUNTIMES.includes('node') ? 'node' : RUNTIMES[0];
let vcpu = VCPUS.includes('1') ? '1' : VCPUS[0];

function combo() { return runtime + '-' + vcpu + 'cpu'; }
function getVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function renderSegs() {
  const rSeg = document.getElementById('runtimeSeg');
  rSeg.innerHTML = RUNTIMES.map((r) => '<button aria-pressed="' + (r === runtime) + '" data-runtime="' + r + '">' + r + '</button>').join('');
  const vSeg = document.getElementById('vcpuSeg');
  vSeg.innerHTML = VCPUS.map((v) => '<button aria-pressed="' + (v === vcpu) + '" data-vcpu="' + v + '">' + v + ' vCPU</button>').join('');
  rSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { runtime = b.dataset.runtime; render(); }));
  vSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { vcpu = b.dataset.vcpu; render(); }));
}

let chartLayout = null;

function drawChart(data, hoverIdx) {
  const c = document.getElementById('chart');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.scale(dpr, dpr);
  const pad = { l: 56, r: 16, t: 16, b: 28 };
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
  const series = [
    { key: 'all', color: getVar('--s-all') },
    { key: 'withoutCounter', color: getVar('--s-nocounter') },
    { key: 'baseline', color: getVar('--s-baseline') },
  ];
  const allVals = data.overall.flatMap((o) => series.map((s) => o[s.key]).filter((v) => v != null));
  const maxV = (Math.max(...allVals) || 1) * 1.08;
  const n = data.versions.length;
  const x = (i) => pad.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => pad.t + plotH - (v / maxV) * plotH;
  chartLayout = { w, h, pad, plotW, plotH, n, x, data, series };

  const firstCounterIdx = data.overall.findIndex((o) => o.hasCounter);
  if (firstCounterIdx > 0) {
    const bandX0 = pad.l, bandX1 = x(firstCounterIdx - 1) + (x(1) - x(0)) / 2;
    ctx.fillStyle = getVar('--grid');
    ctx.globalAlpha = 0.5;
    ctx.fillRect(bandX0, pad.t, bandX1 - bandX0, plotH);
    ctx.globalAlpha = 1;
    ctx.fillStyle = getVar('--ink-2');
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.save();
    ctx.translate(bandX0 + 4, pad.t + 10);
    ctx.fillText('no counter phases yet: all = without counter', 0, 0);
    ctx.restore();
  }

  ctx.strokeStyle = getVar('--grid');
  ctx.fillStyle = getVar('--ink-2');
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.lineWidth = 1;
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const v = (maxV / gridLines) * i;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    ctx.fillText(Math.round(v), 4, yy + 3);
  }
  ctx.textAlign = 'center';
  data.versions.forEach((v, i) => ctx.fillText(v, x(i), h - 8));
  ctx.textAlign = 'left';

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    if (s.key === 'withoutCounter') ctx.setLineDash([6, 4]);
    ctx.beginPath();
    let started = false;
    data.overall.forEach((o, i) => {
      const v = o[s.key];
      if (v == null) return;
      const px = x(i), py = y(v);
      if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = s.color;
    data.overall.forEach((o, i) => {
      const v = o[s.key];
      if (v == null) return;
      ctx.beginPath(); ctx.arc(x(i), y(v), 2.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
    const px = x(hoverIdx);
    ctx.strokeStyle = getVar('--ink-2');
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + plotH); ctx.stroke();
    ctx.setLineDash([]);
    const o = data.overall[hoverIdx];
    const boxLines = [data.versions[hoverIdx]].concat(
      series.filter((s) => o[s.key] != null).map((s) => s.key + ': ' + Math.round(o[s.key]))
    );
    if (!o.hasCounter) boxLines.push('(no counter phases yet)');
    ctx.font = '11px "IBM Plex Mono", monospace';
    const boxW = Math.max(...boxLines.map((l) => ctx.measureText(l).width)) + 12;
    const boxH = boxLines.length * 14 + 8;
    let boxX = px + 8;
    if (boxX + boxW > w - pad.r) boxX = px - boxW - 8;
    const boxY = pad.t + 4;
    ctx.fillStyle = getVar('--surface');
    ctx.strokeStyle = getVar('--grid');
    ctx.lineWidth = 1;
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = getVar('--ink');
    boxLines.forEach((l, i) => ctx.fillText(l, boxX + 6, boxY + 14 + i * 14));
  }
}

function drawTable(data) {
  const t = document.getElementById('phaseTable');
  const hideCounter = document.getElementById('hideCounterRows').checked;
  const thead = '<thead><tr><th>Phase</th>' + data.versions.map((v) => '<th>' + v + '</th>').join('') + '</tr></thead>';
  const rows = data.phases.map((p, i) => {
    const cls = p.counter ? ' class="counter' + (hideCounter ? ' hidden' : '') + '"' : '';
    return '<tr' + cls + ' data-phase-i="' + i + '"><td>' + p.name + (p.counter ? ' (counter)' : '') + '</td>' +
      p.ops.map((v) => '<td>' + (v == null ? 'n/a' : v) + '</td>').join('') + '</tr>';
  }).join('');
  t.innerHTML = thead + '<tbody>' + rows + '</tbody>';
}

// Row-hover overlay: a small sparkline of that phase's own ops/s across
// versions, since its scale usually has nothing to do with the main chart's.
const tip = document.getElementById('tip');
const tipTitle = document.getElementById('tipTitle');
const tipCanvas = document.getElementById('tipCanvas');
let currentData = null;

function showTip(e, phase) {
  tipTitle.textContent = phase.name + (phase.counter ? ' (counter)' : '');
  const ctx = tipCanvas.getContext('2d');
  const w = tipCanvas.width, h = tipCanvas.height;
  ctx.clearRect(0, 0, w, h);
  const vals = phase.ops.filter((v) => v != null);
  if (vals.length) {
    const maxV = Math.max(...vals), minV = Math.min(...vals, 0);
    const n = phase.ops.length;
    const x = (i) => (n === 1 ? w / 2 : (i / (n - 1)) * (w - 8) + 4);
    const y = (v) => h - 4 - ((v - minV) / ((maxV - minV) || 1)) * (h - 8);
    ctx.strokeStyle = getVar('--s-all');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    phase.ops.forEach((v, i) => {
      if (v == null) return;
      const px = x(i), py = y(v);
      if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
    });
    ctx.stroke();
  }
  tip.style.display = 'block';
  moveTip(e);
}
function moveTip(e) {
  const pad = 14;
  let left = e.clientX + pad, top = e.clientY + pad;
  if (left + 220 > window.innerWidth) left = e.clientX - 220 - pad;
  if (top + 90 > window.innerHeight) top = e.clientY - 90 - pad;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function hideTip() { tip.style.display = 'none'; }

document.getElementById('phaseTable').addEventListener('mouseover', (e) => {
  const tr = e.target.closest('tr[data-phase-i]');
  if (!tr || !currentData) return;
  showTip(e, currentData.phases[+tr.dataset.phaseI]);
});
document.getElementById('phaseTable').addEventListener('mousemove', (e) => {
  if (tip.style.display === 'block') moveTip(e);
});
document.getElementById('phaseTable').addEventListener('mouseout', (e) => {
  const tr = e.target.closest('tr[data-phase-i]');
  if (!tr) return;
  if (e.relatedTarget && tr.contains(e.relatedTarget)) return;
  hideTip();
});

document.getElementById('chart').addEventListener('mousemove', (e) => {
  if (!chartLayout || !currentData) return;
  const rect = e.target.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const { pad, plotW, n, x } = chartLayout;
  let idx = Math.round(((mx - pad.l) / plotW) * (n - 1));
  idx = Math.max(0, Math.min(n - 1, idx));
  drawChart(currentData, idx);
});
document.getElementById('chart').addEventListener('mouseleave', () => {
  if (currentData) drawChart(currentData);
});

function renderChangelog() {
  const el = document.getElementById('changelog');
  el.innerHTML = VERSIONS.map((v) => {
    const entry = CHANGELOG[v];
    if (!entry) return '<details><summary><b>' + v + '</b><span>no changelog entry</span></summary></details>';
    return '<details><summary><b>' + v + '</b><span>' + entry.date + '</span></summary><ul>' +
      entry.bullets.map((b) => '<li>' + b.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</li>').join('') +
      '</ul></details>';
  }).join('');
}

function render() {
  renderSegs();
  const data = COMBOS[combo()];
  currentData = data;
  hideTip();
  const canvas = document.getElementById('chart');
  const table = document.getElementById('phaseTable');
  document.querySelectorAll('.empty').forEach((e) => e.remove());
  if (!data) {
    canvas.style.display = 'none';
    table.style.display = 'none';
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No data for ' + combo() + '.';
    canvas.after(p);
    document.getElementById('meta').textContent = '';
    return;
  }
  canvas.style.display = '';
  table.style.display = '';
  drawChart(data);
  drawTable(data);
  document.getElementById('meta').textContent = data.versions.length + ' versions, ' + data.baselineCount + ' baseline phases common to all of them.';
}

document.getElementById('hideCounterRows').addEventListener('change', render);
window.addEventListener('resize', () => { const d = COMBOS[combo()]; if (d) drawChart(d); });
renderChangelog();
render();
</script>
`;
writeFileSync(path.join(resultsDir, 'report.html'), html);
console.error(`report.html written: ${Object.keys(combosData).length} combos, ${comboNames.length} discovered`);
