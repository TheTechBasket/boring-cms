# bulk_rewrite_refs performance fix

**Status:** fix implemented and bench-verified locally; not pushed. Open decision below needs prod numbers.

## Problem

`bulk_rewrite_refs` (MCP) and `POST /api/v1/<project>/rewrite-refs` (REST) call `bulkRewriteRefs` in `lib/content.ts`. On prod:

- 1 pair, `dry_run`: HTTP 200, matched 985, 55.4s
- 150 pairs: HTTP 504 (Cloudflare ~100s gateway cap)
- full 2216 pairs: HTTP 504

## Root cause

The shipped v0.17.0 body ran one full-table `instr()` scan per pair for counting, plus a second per pair for the live `UPDATE`. A substring match cannot use an index, so each scan was the whole `entries` table. Cost was O(entries x pairs):

- 1 pair = 1 scan = ~55s on prod volume
- 2216 pairs = 2216 scans = tens of hours, so any real map hit the 504

The v0.17.0 changelog claimed "one pass" but the code did not do one.

## Fix (implemented)

Single pass over `entries`, independent of pair count (`lib/content.ts`, `bulkRewriteRefs`):

- Build `Map(old -> new)`; sort olds longest-first so a prefix URL cannot shadow a longer one.
- One combined matcher: `new RegExp(olds.map(escapeRegExp).join('|'), 'g')`. Each old URL is `escapeRegExp`'d, so `%`, `_`, `.` match literally (no wildcard surprise).
- `db.prepare('SELECT id, published_data, data FROM entries').iterate()` streams rows (no full in-memory load). A `swap` callback replaces matched URLs and records which olds were seen per row; only changed rows are buffered.
- Live write: `UPDATE entries SET published_data=?, data=? WHERE id=?` by primary key for the buffered rows, one `bumpContentVersion`, one `ref_rewrites` audit insert, all in one `BEGIN`/`COMMIT`.
- Non-cascading by design: each matched URL is swapped exactly once, so a pair whose `new` equals another pair's `old` does not chain. Matches the original "swap exact full URLs" intent.

Unchanged: validation (non-empty pairs, both full `https://`, old != new), the no-`updated_at`/`published_at` rule (sitemap lastmod stays frozen), single `content_version` bump, drafts rewritten too, `ref_rewrites` audit.

## Measurements (local bench, `bench/bench.mjs`, new `rewrite_*` phases)

Before fix (scale 1, 200 pairs): dry_1pair 3.99ms, dry_200pairs 510ms, live_200pairs 1103ms (linear in pairs).

After fix:

| phase | scale 1, 200 pairs | scale 20, 2216 pairs |
|---|---|---|
| rewrite_dry_1pair | 5.21ms | 69.6ms |
| rewrite_dry_Npairs | 8.19ms | 127ms |
| rewrite_live_Npairs | 13.67ms | 244ms |

O(entries x pairs) is gone: 2216 pairs now costs ~1.8x of 1 pair (one scan, bigger regex), not 2216x. Old code at scale 20 would be ~2216 x 69.6ms = ~154s for the dry count alone.

## Open decision: in-request vs background job

The remaining cost is O(entries): one unavoidable pass to read and rewrite every entry. On prod that single pass was ~55s for the old 1-pair `instr()` scan. The single-pass regex over the full map should run in roughly one-scan time (the ~1.8x regex overhead seen locally), so prod full-map is plausibly in the ~60-110s range: near or over the 100s Cloudflare cap.

We do not have a prod number for the fixed code. Options:

1. **Ship the fix, measure on prod, decide after.** If a full-map `dry_run` on prod comes back under the cap, the in-request path is fine and a background job is YAGNI. If it exceeds the cap, build the job. Recommended: do not build a background job speculatively.
2. **Background job now.** Job row + status endpoint + polling. Safe against the cap regardless of volume, but real added surface for a tool run rarely (post-migration cosmetic swap). Only if prod proves option 1 exceeds the cap.

**Recommendation:** option 1. The fix turns tens of hours into seconds; verify the real prod single-pass time with a full-map `dry_run` before committing to the job. Peer session ttb can re-run the prod `dry_run` once the fix is pushed (needs Amit's explicit go for push and for any live prod run).

## Follow-ups

- CHANGELOG: perf fix to v0.17.0 behavior, patch bump 0.17.1.
- Project CLAUDE.md rule added: new functionality gets a bench phase, run bench before push.
