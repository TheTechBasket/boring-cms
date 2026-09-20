# Counter field (design measured, awaiting Amit's pick)

Saved 2026-09-20. Not built. Lab: `node bench/counter-lab.mjs` (7 variants, real HTTP, server pinned to 1 core, 120k requests, 64 concurrent, 4000 voters, 45% repeat votes).

**Measured (req/s, p99 ms, extra RSS for 111k tracked voters)**
- v0 floor, no state: 17.8k, 7.0. HTTP and JSON only.
- v1 db-direct (UPSERT per request, no dedupe): 14.6k, 8.5. 120k writes.
- v2 db + dedupe map: 13.4k, 9.3. 114k writes, +66 MB.
- v3 batched (memory totals, flush every 5s): 19k, 6.4. 400 writes.
- v4 batched + dedupe map: 18-19k, 6.7. 400 writes, +65 MB.
- v5 token + batched (stateless HMAC, honest clients only): 18k, 6.9. 400 writes, no memory.
- v6 temp log table (Amit's idea): 5.7k, 24. 117k writes, wrong totals (dedupe forgotten when the log is folded).
- v7 batched + compact dedupe (numeric 48-bit hash key, packed value): 18.6-18.9k, 6.6. 400 writes, +10 MB.

**Findings**
- A SQLite UPSERT per bump costs about 18% of the floor. Simplest design (v1) already does 14k bumps/s on one core.
- Batching removes 99.7% of writes and lands at the floor, but adds a flush timer and a crash window of up to 5s.
- Dedupe by hashed ip+ua costs 2-8% CPU. Memory is the real cost: the string-key map is about 590 B per voter, the numeric-key map about 90 B. Cap at 200k voters = about 18 MB (compact).
- The temp log table is 3x slower and less correct. Rejected.
- Token (v5) only helps honest clients, same as a localStorage flag. Skip.

**Options, simplest first**
- A: v1. One table, one UPSERT, no dedupe, no timer. Client localStorage flag stops honest repeats. Per-IP token bucket is the abuse ceiling.
- B: v3. A plus a 5s flush. Only if bump volume gets high.
- C: v7. B plus salted-hash voter map (24h TTL, 200k cap). Server-side repeat and switch handling.
- D: v2 with compact map. A plus dedupe, no flush timer, exact counts on crash.
- Not recommended: v6 log table, v5 token.

**Shared decisions (all options)**
- `counters(entry_id, field, up, down)`, primary key (entry_id, field), WITHOUT ROWID. No revisions, `updated_at`, `content_version`, webhooks or ETag effect.
- POST only. Separate read endpoint, never in the entry payload (it would break 304 caching).
- Field `access: public | key`. Public: no key, delta clamped to one step, per-IP token bucket, CORS on that route. Key: a `counter` scope key, arbitrary delta allowed.
- Key extras, in order: `counter` scope, allowed origins per key, per-key rate limit override, key expiry.
- Bench phase for the bump endpoint (single and concurrent) before push.

**Open questions**
- [ ] Pick A, B, C or D.
- [ ] Public voting opt-in per field, off by default?
- [ ] Vote mode (up/down with switch) and count mode (+1 only, views) both, or vote only?
