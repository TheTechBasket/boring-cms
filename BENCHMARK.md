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

## Latest: v0.21.0 (2026-09-20, node 24.13, 1 vCPU)

Peak RSS 127 MB. Zero errors.

| Operation | ops/s | p50 | p95 |
|---|---:|---:|---:|
| Read single entry | 3800 | 0.23 ms | 0.34 ms |
| Read list (short, 2 fields) | 3648 | 0.25 ms | 0.39 ms |
| Read list (long, 14 fields, 5.5 KB body) | 2313 | 0.32 ms | 0.64 ms |
| 304 revalidation (ETag) | 4251 | 0.21 ms | 0.31 ms |
| 20 parallel readers | 6305 | 2.27 ms | 5.29 ms |
| Create entry, short | 1333 | 0.66 ms | 1.08 ms |
| Create entry, long | 876 | 1.03 ms | 1.84 ms |
| Update then read back | 1076 | 0.83 ms | 1.40 ms |
| Batch create, 200 per call | 116 batches/s (about 23k entries/s) | 8.6 ms | 8.7 ms |
| 10 parallel writers | 3262 | 2.24 ms | 5.16 ms |
| Media upload 64 KB | 795 | 0.84 ms | 2.00 ms |
| Media serve 64 KB | 1393 | 0.54 ms | 0.94 ms |
| Schedule future publish | 990 | 0.85 ms | 1.27 ms |
| Counter votes (public, mixed voters) | 8900 | 3.06 ms | 6.19 ms |
| Counter votes on one hot entry | 8200 | 6.17 ms | 16.1 ms |
| OpenAPI spec read (cached) | 5887 | 1.14 ms | 2.29 ms |
| Bulk ref rewrite, 200 pairs, live | 96 | 10.4 ms | n/a |

Rate limiter on (production default path): 2243 ops/s at 0.27 ms p50, so
enforcement costs little.

Full 42-phase table: `bench/results/v0.21.0/summary.md`.

## Trend across versions (node, 1 vCPU, p50 ms)

| Operation | v0.11 | v0.17 | v0.18.3 | v0.19.1 | v0.20 | v0.21 |
|---|---:|---:|---:|---:|---:|---:|
| Read single | 0.31 | 0.30 | 0.29 | 0.22 | 0.18 | 0.23 |
| Read list, short | 0.45 | 0.61 | 0.57 | 0.25 | 0.21 | 0.25 |
| Read list, long | 1.69 | 2.47 | 2.47 | 0.35 | 0.27 | 0.32 |
| 304 revalidation | 0.24 | 0.26 | 0.25 | 0.19 | 0.17 | 0.21 |
| Create short | 0.95 | 0.92 | 0.89 | 0.67 | 0.47 | 0.66 |
| Batch x200 | 25.0 | 24.8 | 23.2 | 8.4 | 7.8 | 8.6 |
| 20 parallel reads | 3.52 | 3.61 | 3.44 | 2.37 | 1.88 | 2.27 |

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

## Runtimes (v0.11.0, the only run that covered all three)

Node, Bun 1.4.2 and Deno 2.9.6 all run the server unmodified. Differences
were small: Bun led writes and batch (about 1.15x) and used the least RSS
(95 MB vs 119 node vs 168 deno); Node led 304 revalidation; Deno was slowest
on media upload. 2 and 4 vCPU changed almost nothing, as expected: the app
is single-threaded, extra cores only help the OS and network stack. Node 24
stays the supported target; Bun single-binary is in the plans backlog.

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
| One global content version per project: publishing anywhere invalidates cached lists for every collection | Still true, by design. Whole-project invalidation is O(1) and never stale. Revisit past about 100k entries or heavy multi-collection polling |
| In-memory rate buckets reset on restart, no multi-process support | Known boundary of the single-process target |
| No automated backups while real data lives in `./data` | Open. Nightly per-project SQLite copy plus media manifest is in `plans/README.md` backlog. Whole-project export/import over the API exists as the manual path |

## Verdict

The target is many small projects on one cheap box, WordPress migrations
first. The numbers back it: sub-millisecond reads with headroom past 3000
rps on one core, write lifecycle about 1000 ops/s, bulk import in the tens of
thousands of entries per second, about 130 MB RSS. Remaining risk is
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
