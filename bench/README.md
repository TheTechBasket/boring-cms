# Benchmark suite

Reusable, versioned benchmarks for Boring CMS. Run the same suite after each
release and compare `bench/results/v<version>/summary.md` across versions.

## How to run

```sh
bash bench/run.sh                 # full matrix: node,bun,deno x 1,2,4 vCPU
bash bench/run.sh node 1          # one combo
bash bench/run.sh node,bun 1,2    # subset
```

Results: `bench/results/v<version>/<runtime>-<n>cpu.json` (raw per-phase
numbers with epoch timestamps), `<label>.usage.csv` (~100ms CPU tick + RSS
samples of the server process), `<label>.server.log` (server stderr),
`summary.md` (tables). Commit all of it; that is the historical record.

Cross-version trend: `node bench/trend.mjs [combo]` (default `node-1cpu`)
reads every `bench/results/v*/` directory and writes a markdown table for
one combo plus `bench/results/report.html`, a single self-contained,
filterable report (runtime, vCPU, counter-phases on/off) covering every
runtime/vCPU combo and every version, with the changelog inline. Open it
in a browser. Regenerate after adding a new version's results.

## What it measures

One driver (`bench.mjs`, plain Node, HTTP only) walks the real public
surface, per run:

- Schema: REST schema apply (create + mutate two collections), schema reads.
  Two shapes on purpose: `short-posts` (2 fields) vs `long-articles`
  (14 fields, ~5.5 KB markdown body) to expose payload-size effects.
- Writes: individual `create_entry` (MCP, publish immediately) for both
  shapes; `batch_create_entries` at 200/batch.
- Reads: list + single entry through `/api/v1` for both shapes, ETag 304 path.
- Update-then-read: `update_entry` with publish, then immediate public API
  read asserting the new value (write -> materialize -> read roundtrip).
- Media (local disk backend only, S3 skipped: costs money): 64 KB uploads via
  the REST media route, serving the returned links back, re-upload
  ("update"; content-hash keys mean new bytes = new object), delete.
- Link access: slugs pulled from a live list response, each fetched.
- Concurrency probes: 20 parallel readers, 10 parallel writers.
- Deletes: `delete_entry`.

Each phase reports ops/s, p50/p95/p99/max latency, error count. A phase
aborts if more than 5% of its ops error.

## Constraints (read before interpreting numbers)

- **Fresh DB per run.** Each run gets `mktemp -d` as `YNCMS_DATA_DIR` and the
  dir is deleted afterward. No warm SQLite page cache from earlier runs, no
  neighbor data. Numbers are cold-start-ish, single-project.
- **CPU pinning simulates a small VPS.** `taskset -c` pins the *server* to
  1, 2, or 4 cores of a 12-core desktop (target analogy: 5-10 USD VPS,
  1-2 vCPU, 1-2 GB shared RAM). A real VPS core is usually slower than a
  pinned desktop core and is shared with neighbors, so treat these as
  upper bounds. The app is single-threaded (no cluster), so 2 and 4 vCPU
  mainly help the OS/network stack, not request handling: small deltas
  across vCPU counts are expected, not a bug.
- **Memory caps**: node `--max-old-space-size=768`, deno
  `--v8-flags=--max-old-space-size=768`, bun `--smol` (JSC has no direct
  equivalent flag; peak RSS is recorded instead). RAM is not cgroup-limited;
  the cap constrains the JS heap only.
- **Client is unpinned**, running on the remaining host cores over loopback.
  This measures server capacity, not client capacity, and excludes real
  network latency. Sequential phases are concurrency 1: one client doing
  back-to-back requests, so ops/s ~= 1000/p50.
- **Rate limit raised.** The driver sets the project rate limit to 10^8
  req/min. The shipped default is 60 req/min per key; production consumers
  hit 429 long before any number in these tables.
- **npm vs pnpm are not runtimes.** Zero runtime dependencies means the
  package manager never appears in the serving path; `npm start` and
  `pnpm start` execute the identical `node server.ts`. Only node, bun, and
  deno are distinct engines, so only those are in the matrix.
- **Runtime support is best-effort.** The server targets Node 24
  (`node:sqlite`, native TS). If bun or deno cannot run it, the run is
  recorded as failed with the log tail, which is itself a useful
  compatibility datapoint per version.
- **Driver overhead included.** Timings are client-observed over loopback
  HTTP (fetch), so they include serialization and loopback cost, same as a
  real consumer on the box.

## Comparing versions

1. Ship the release (version bumped in package.json).
2. `bash bench/run.sh`
3. Commit the new `bench/results/v<version>/` directory.
4. Diff `summary.md` against the previous version's. Watch for: read p50
   regressions (hot path), create ops/s (editorial/import path), and peak
   RSS growth (small-VPS fit).

If phase sizes must change, bump the `--scale` flag rather than editing
counts, or note the change here; cross-version comparison assumes identical
workloads.

## Benchmark v2 (bench2.mjs + run2.sh)

v1 above is frozen so its result history stays comparable. v2 is the new
baseline going forward:

- **Automatic field coverage.** The driver asks the running server
  `GET /api/v1/<project>/field-types` and generates `field_<type>_write` and
  `field_<type>_read` phases for every reported type, plus vote phases for
  `counter` (vote, read totals) and `countermap` (vote, group switch, read
  totals). A new field type gets benchmarked with zero driver changes; only a
  type whose value cannot default to a string needs one line in `VALUES`.
- **Per-field isolation.** One single-field collection per type, so a
  slowdown names the field type instead of hiding in a mixed collection.
- **Longer phases.** v1 whole runs were about 10s wall, which made single
  runs swing 10-25% on machine noise (the v0.24.0 dip was exactly this, a
  noisy session, confirmed by interleaved A/B runs). v2 runs about 20s per
  combo with 4-6x the samples on hot phases.
- **Cross-version history.** `run2.sh --src <checkout> --version vX` starts
  the server from any git worktree but drives it with the current v2 client,
  so one driver produces a comparable series. Seeded history starts at
  v0.19.1 (one version before the counter field).

Run: `bash bench/run2.sh` (node, 2 vCPU) or `bash bench/run2.sh node,bun,deno 1,2,4`.
Results land in `bench/results-v2/<version>/`; same JSON shape as v1, same
`summarize.mjs`, same constraints as above.

Each run also regenerates `bench/results-v2/report.html` (`node
bench/report2.mjs`): the whole version history as one page, per-phase ops/s
across every benchmarked version with deltas and trend sparklines, the
CHANGELOG entry of each version next to the numbers, and the v1-to-v2
rationale above. Open it in a browser after a run; commit it with the
results.
