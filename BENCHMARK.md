# Benchmarks

How fast is Boring CMS on the cheapest box it would realistically run on,
and does load break anything. Short version: reads are sub-millisecond,
writes are about 1 ms, auth is enforced identically on every surface, and
per-project SQLite files keep neighbors untouched.

Two sources feed this page:

- The repeatable suite in `bench/` (run `bash bench/run.sh` after each
  release). Raw numbers and `summary.md` per version live in
  `bench/results/v<version>/`. Method and constraints: `bench/README.md`.
- A one-off stress test on 2026-09-09 against a real data directory
  (section "Stress test findings" below). Its numbers are superseded by the
  suite; its findings are kept.

## Setup

Target box: a 5-10 USD VPS (1 vCPU, about 1 GB RAM). Simulated on a Ryzen 5
5600X: server pinned to one core with `taskset`, Node heap capped at 768 MB,
fresh temp data dir per run, one sequential client over loopback
(concurrency 1, so ops/s is about 1000 / p50), rate limit raised to 10^8/min.
A real VPS core is slower and shared, so treat every number as an upper
bound. Read `bench/README.md` before comparing runs.

## Latest: v0.25.0 (2026-10-06, node 24.13, 1 vCPU)

Peak RSS 154 MB. Zero errors in all 58 phases on node, bun and deno.

| Operation | ops/s | p50 | p95 |
|---|---:|---:|---:|
| Read single entry | 5256 | 0.18 ms | 0.23 ms |
| Read list (short, 2 fields) | 3834 | 0.22 ms | 0.44 ms |
| Read list (long, 14 fields, 5.5 KB body) | 2756 | 0.23 ms | 0.87 ms |
| 304 revalidation (ETag) | 4971 | 0.17 ms | 0.26 ms |
| Version map (`/_version`, every collection's tag) | 3275 | 0.21 ms | 0.45 ms |
| Version map 304 | 5183 | 0.19 ms | 0.24 ms |
| 20 parallel readers | 7594 | 2.33 ms | 5.11 ms |
| Create entry, short | 1331 | 0.66 ms | 1.08 ms |
| Create entry, long | 784 | 1.05 ms | 2.25 ms |
| Update then read back | 899 | 1.03 ms | 1.60 ms |
| Republish (preserve timestamps), read list before and after | 632 | 1.38 ms | 3.48 ms |
| Batch create, 200 per call | 97 batches/s (about 19k entries/s) | 9.7 ms | 13.0 ms |
| 10 parallel writers | 3256 | 2.54 ms | 4.95 ms |
| Media upload 64 KB | 1221 | 0.71 ms | 1.02 ms |
| Media serve 64 KB | 1329 | 0.48 ms | 1.20 ms |
| Schedule future publish | 1069 | 0.85 ms | 1.25 ms |
| Counter votes (public, mixed voters) | 9234 | 3.02 ms | 6.01 ms |
| Counter votes on one hot entry | 9715 | 5.50 ms | 13.3 ms |
| OpenAPI spec read (cached) | 6990 | 1.01 ms | 1.58 ms |
| Bulk ref rewrite, 200 pairs, live | 76 | 13.1 ms | n/a |

Rate limiter on (production default path): 3654 ops/s at 0.20 ms p50.

Full 58-phase table for every runtime and vCPU count:
`bench/results/v0.25.0/summary.md`. Against v0.24.0 the median phase is
1.04x to 1.10x on every runtime and no phase is slower by more than 10% in
6 of the 9 combos.

## Trend across versions (node, 1 vCPU, p50 ms)

| Operation | v0.11 | v0.17 | v0.18.3 | v0.19.1 | v0.20 | v0.21 | v0.25 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Read single | 0.31 | 0.30 | 0.29 | 0.22 | 0.18 | 0.23 | 0.18 |
| Read list, short | 0.45 | 0.61 | 0.57 | 0.25 | 0.21 | 0.25 | 0.22 |
| Read list, long | 1.69 | 2.47 | 2.47 | 0.35 | 0.27 | 0.32 | 0.23 |
| 304 revalidation | 0.24 | 0.26 | 0.25 | 0.19 | 0.17 | 0.21 | 0.17 |
| Create short | 0.95 | 0.92 | 0.89 | 0.67 | 0.47 | 0.66 | 0.66 |
| Batch x200 | 25.0 | 24.8 | 23.2 | 8.4 | 7.8 | 8.6 | 9.7 |
| 20 parallel reads | 3.52 | 3.61 | 3.44 | 2.37 | 1.88 | 2.27 | 2.33 |

What moved the numbers:

- v0.14 to v0.17: list reads regressed about 30%, caught only because the
  same workload ran each release.
- v0.19.0: memoized prepared statements per database handle, `last_used_at`
  written at most once a minute instead of on every read, cached collection
  id and scheduled-entry count, cached list response bodies. Long lists went
  from 2.4 ms to 0.35 ms, batch create 3x faster.
- v0.20.0 vs v0.21.0: v0.20 ran on a quieter host. Treat swings of 20-30%
  between adjacent runs as noise unless a phase moves alone. Compare
  against the previous run on the same day if a regression is suspected.
- v0.25.0: per-collection ETags and the `/_version` map. A first cut sorted
  list pages by `id DESC` as a tiebreak, which forced a temp B-tree sort of
  every published row on each uncached list read (republish phase 720 to
  400 ops/s). Sorting by `id` ascending follows the index rowid order, so
  there is no extra sort. The new `total` count costs about 7% on uncached
  list reads only.

## Runtimes (v0.25.0, 1 vCPU)

Node 24.13, Bun 1.4.2 and Deno 2.9.6 all run the server unmodified, and every
release since v0.24 runs the full matrix. Peak RSS: node 154 MB, deno 165 MB,
bun 176 MB. Throughput differences per phase stay within about 15%. 2 and 4
vCPU change little: the app is single-threaded, extra cores only help the OS
and network stack. Node 24 stays the supported target; Bun single-binary is
in the plans backlog.

A busy host distorts the matrix: one run on 2026-10-06, during an Android
emulator boot (load average 39, swap full), took 107 s instead of 9 s and
logged request timeouts. Check `uptime` and `free -m` before a run.

## Stress test findings (2026-09-09, real data dir)

A one-off run against a live data directory (119 MB, 4025-entry neighbor
project) with all traffic confined to a throwaway `bench-tmp` project. After
the run both neighbor DBs verified byte-identical by sha256 and the bench
project was deleted.

Held up:

- Auth boundaries: 401 without or with a bad key (0.2 ms, rejected before
  any content read), 403 for a read key on any write route (REST and MCP
  alike), 302 for a logged-out admin page. Zero side effects from refused
  calls.
- Isolation: per-project SQLite files plus WAL. Hammering one project left
  the others untouched, and 20 parallel readers did not serialize.
- The database is not the bottleneck: in-process list query 0.13 ms vs
  0.71 ms over HTTP. The rest is HTTP, key verification and JSON.
- Wrong-password login costs about 28 ms by design (password hashing). Keep
  it; do not "optimize" the hash.

Findings and where they stand now:

| Finding (2026-09-09) | Status |
|---|---|
| `last_used_at` written on every authenticated read | Fixed in v0.19.0 (at most once a minute per key) |
| Per-key rate limit (60/min) throttles bulk agent work and any load test | Now editable per project, both limits off by default for new projects (v0.21.0). Benchmarks still raise it, so they measure the server, not the limiter |
| Rate-limit buckets grow without bound | Pruned at 10k callers (v0.19.1); sweep throttled to every 30 s (v0.20.0) after it slowed many-IP traffic 3x |
| Round-1 harness counted MCP 429s as successes (JSON-RPC errors return HTTP 200) | Driver asserts on the RPC payload |
| One global content version per project: publishing anywhere invalidates cached lists for every collection | Fixed in v0.25.0: ETags are per collection. Imports, restores, ref rewrites and collection deletes still move every tag |
| List response cache bounded by entry count only (500 pages of any size per project) | Fixed in v0.25.0: also capped at 32 MB of bodies per project. Paging a 4,000-entry collection held about 1.2 GB on prod before |
| In-memory rate buckets reset on restart, no multi-process support | Known boundary of the single-process target |
| No automated backups while real data lives in `./data` | Open. Nightly per-project SQLite copy plus media manifest is in `plans/README.md` backlog. Whole-project export/import over the API exists as the manual path |

## Verdict

The target is many small projects on one cheap box, including migrations
from WordPress. The numbers back it: sub-millisecond reads with headroom past 3000
rps on one core, write lifecycle about 1000 ops/s, bulk import in the tens of
thousands of entries per second, about 150 MB RSS. Remaining risk is
operational, not performance: automated backups and local-disk media growth
on a small VPS disk.

## Running it

```sh
bash bench/run.sh node 1     # one combo, about 10 s
bash bench/run.sh            # node, bun, deno x 1, 2, 4 vCPU
```

New endpoint, tool or data operation: add a phase to `bench/bench.mjs`,
run the suite, commit `bench/results/v<version>/`. Keep phase counts fixed
(use `--scale`) so versions stay comparable.
