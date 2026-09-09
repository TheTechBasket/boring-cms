# Benchmark: small-VPS stress test (2026-09-09)

How fast is this CMS on the cheapest box it would realistically run on, and
does load testing break anything. Short version: reads are very fast,
writes are fast, auth enforcement is correct, neighbor data untouched.

This was a one-off exploratory run. The repeatable, versioned suite now
lives in `bench/` (scripts, constraints, per-version results under
`bench/results/`); run `bash bench/run.sh` after each release.

## Analogy used

Target machine: a 5-10 USD VPS (1 vCPU, ~1 GB RAM). Simulated on this dev
machine with:

- `taskset -c 0`: server process pinned to one CPU core (affinity mask `1`,
  verified). Node is single-threaded for this app anyway; this removes the
  "12-core dev machine" advantage for event-loop and SQLite work.
- `node --max-old-space-size=768`: heap capped at 768 MB, leaving room for
  OS + SQLite page cache inside ~1 GB, like a small VPS.
- Port 4101, same `./data` directory as real usage (not a tmp dir), so the
  test proves isolation against real neighbor data instead of assuming it.
- Load pattern: strictly sequential requests (concurrency 1) with 5 warmup
  iterations before each measurement. This is the "1 thread" case: one
  client doing back-to-back requests, no parallelism except one explicit
  20-parallel probe noted below.
- S3 storage not tested per scope. Local disk media backend tested
  (upload + serve). No image variants (sharp not installed here).

## Isolation method (no corruption of other collections)

- Full backup first: `data/core.db`, `data/projects/thetechbasket.db`
  (119 MB, 4025 entries), `data/projects/test.db` copied to
  `/tmp/yncms-bench-backup`, plus sha256 recorded before the run.
- All test traffic went to a dedicated project `bench-tmp` /
  collection `bench-posts` (fields: title:text, body:markdown,
  views:number), seeded with 200 published entries. No test request ever
  addressed `thetechbasket` or `test`. API keys created for the bench
  project only (one `read`, one `write`).
- After the run: bench project row deleted, its `.db` file destroyed,
  `data/media/bench-tmp` removed, server stopped.
- Verification: `sha256sum -c` on both neighbor DBs -> OK,
  `SELECT slug FROM projects` shows only `test` and `thetechbasket`.

## Results (sequential, 1 CPU, 768 MB heap)

Reads (public REST, Bearer key). No rate limit applies to GET reads.

| operation | n | p50 | p95 | max | rps |
|---|---|---|---|---|---|
| list, limit=50 | 300 | 0.71 ms | 1.69 ms | 6.57 ms | ~1160 |
| list, limit=10 | 300 | 0.50 ms | 1.02 ms | 3.72 ms | ~1754 |
| single entry get | 300 | 0.35 ms | 0.72 ms | 2.50 ms | ~2521 |
| 304 revalidation (If-None-Match) | 100 | 0.68 ms | 1.28 ms | 5.20 ms | ~1283 |
| schema read | 200 | 0.28 ms | 0.37 ms | 3.23 ms | ~3133 |
| MCP list_entries, limit=10 | 200 | 0.52 ms | 0.93 ms | 2.54 ms | ~1733 |

Writes (MCP tools, write-scope key, every step asserted OK, 0 failures):

| operation | n | p50 | p95 | max | rps |
|---|---|---|---|---|---|
| create_entry (draft) | 100 | 1.02 ms | 1.67 ms | 3.47 ms | ~885 |
| publish_entry | 100 | 1.22 ms | 2.23 ms | 7.70 ms | ~709 |
| update_entry (revision delta) | 100 | 1.14 ms | 1.63 ms | 16.17 ms | ~759 |
| delete_entry | 100 | 1.47 ms | 2.55 ms | 6.05 ms | ~619 |
| batch_create_entries x10, published | 20 | 3.08 ms | 7.55 ms | 7.55 ms | ~312 batches/s (~0.32 ms/entry) |

Local media (REST, write-scope key):

| operation | n | p50 | p95 | max | rps |
|---|---|---|---|---|---|
| upload 4 KB file | 40 | 1.31 ms | 2.54 ms | 3.03 ms | ~720 |
| serve file back | 100 | 0.73 ms | 1.73 ms | 5.25 ms | ~1163 |

Auth and request-flow checks on collections (all matched expected status):

| operation | n | p50 | note |
|---|---|---|---|
| no key -> 401 | 100 | 0.22 ms | 100/100 matched |
| bad key -> 401 | 200 | 0.25 ms | rejects before any DB read of content |
| read key on write route -> 403 | 100 | 0.31 ms | scope enforced at every write surface (REST + MCP) |
| logged-out admin page -> 302 | 200 | 0.19 ms | session guard redirects, no render work |
| wrong-password login -> 401 page | 50 | 28.3 ms | dominated by password hashing cost (expected) |
| MCP write tool on read key | 100 | 0.41 ms | refused with read-only error, 0 side effects |

Overhead and contention probes:

- In-process `listPublished` (same query, no HTTP): p50 0.13 ms vs 0.71 ms
  over HTTP. SQLite does the real work in ~0.1 ms; ~0.6 ms is HTTP +
  key verification + JSON. The DB is not the bottleneck.
- 20 parallel reads finished in 46 ms total with no errors. Per-project
  SQLite files plus WAL mean parallel readers do not serialize badly.
- Server RSS after the full run: ~185 MB (heap cap never approached).

## Rate limiter: what round 1 tripped over

The first measurement round showed mass failures on MCP/media/schema-POST
calls. Cause: the per-key token bucket (`DEFAULT_RATE_LIMIT = 60`
requests/minute, `lib/mcp.ts`) correctly returned 429 for everything past
the burst. REST GET reads are not limited, which is why read numbers were
clean from the start. For round 2 the bench project's `rate_limit_per_min`
meta was raised to 100000 (a supported per-project setting), the run
repeated with strict per-step assertions (0 failures everywhere), and the
setting died with the bench project DB. Two consequences worth keeping:

1. Any future load test or bulk importer must raise the limit or bring
   more keys; otherwise it measures the limiter, not the server.
2. The 60/min default also throttles legitimate agent/MCP bulk work
   (the plans backlog already notes per-key request stats; consider
   documenting the tunable on the API keys page).

## Bugs found

None that corrupt or lose data. The run surfaced observations, not
defects:

1. (Harness, not server) Round-1 write timings mixed HTTP 429 responses
   into "ok" samples because MCP errors still return HTTP 200 with a
   JSON-RPC error body. Discarded; round 2 asserts on the RPC payload.
2. Pre-existing type hygiene: `npx tsc --noEmit` scope has 10 implicit-any
   errors in `server.ts` and 1 in `lib/mcp.ts` (visible in editor
   diagnostics). Unrelated to performance, but the "full checks before
   commit" gate (`pnpm css`, `tsc --noEmit`, `pnpm smoke`) should be green.
3. Coarse ETag: one global `content_version` per project, so publishing
   any entry invalidates cached lists for every collection. Correct, just
   coarser than needed; fine at this scale, revisit past ~100k entries or
   heavy multi-collection polling.

## Where it needs improvement

- `verifyApiKey` writes `last_used_at` on every authenticated request,
  including reads. A DB write on the read hot path costs WAL traffic and a
  lock acquisition per request; under parallel load this is the first
  contention point. Throttle it (update at most once per N minutes per key)
  or move to an in-memory counter flushed on a timer (same pattern the
  plans backlog proposes for request stats).
- Password hashing dominates login (~28 ms). Fine and intentional, but it
  means the login route is the only cheap DoS amplifier; the existing
  behavior (401 with generic message, no user enumeration) is correct, keep
  it and do not "optimize" the hash.
- In-memory rate-limit buckets reset on restart and do not work across
  processes. True only if deployment ever goes multi-process; single
  process on a small VPS is the documented target, so this is a known
  boundary, not a flaw.
- No read replicas / Litestream backups (deliberately deferred in
  ARCHITECTURE.md). The 119 MB neighbor DB shows real sites already live
  here; the planned nightly per-project SQLite backup (plans backlog)
  should come before more features.

## Where it works great

- Read path: 0.3-0.7 ms p50 on one core. Publish-time materialization
  works as designed; the public API does one row read, no joins.
- Write path: full create-publish-update-delete lifecycle at ~600-900
  ops/s sequential; batch import at ~3000 entries/s. More than enough for
  editorial and migration workloads.
- Auth boundaries held under load: 401/403/302 all correct, 500/500+
  matched in strict re-runs, scope separation between read and write keys
  enforced identically on REST and MCP.
- Isolation: per-project DB files did their job; hammering `bench-tmp`
  left `thetechbasket.db` and `test.db` byte-identical.
- Zero-dependency footprint held: ~185 MB RSS total, no external services
  touched, S3 code path never loaded.

## Real-world verdict: will this project succeed

Yes, for the target it names in ARCHITECTURE.md: many small projects on
one cheap box, WordPress-site migration first, public product second. The
numbers support it directly:

- A $5-10 VPS serving blogs, marketing sites, and small stores through a
  static-site or cached frontend will see read latencies under 1 ms and
  headroom past 1000 rps on a single core. Even at 1% of that (10 rps
  sustained) the box idles.
- Editorial write volume (dozens of publishes a day, bulk imports of
  thousands) completes in seconds.
- The failure modes found are all "at scale" problems (global ETag,
  last_used_at writes, in-memory buckets, backups) that only bite past
  ~100k entries or multi-process deploys, each with a documented seam.

What could still kill it is not performance but operations: no automated
per-project backups yet while real data already lives in `./data`, and
local-disk media grows silently on a small VPS disk. Ship the nightly
SQLite backup + media manifest from the plans backlog before onboarding
sites that cannot afford to lose content, and this project earns its
"boring" name.
