# Counter field (idea, ask Amit before building)

Saved 2026-09-20. Not started. Ask Amit the open questions below first.

**Idea**
- A `counter` field type: a number that a client bumps and gets the new total back in one call. Uses: poll and quiz votes, page views, up/down votes.
- Atomic increment in SQL (`UPDATE ... SET n = n + ?`) returning the final value. No read-modify-write race.

**Open questions**
- [ ] One counter per field for up and down (signed delta), or two separate counters (up, down)?
- [ ] POST only (`POST .../<entry>/counter/<field>` with `{ delta }`). Never GET, so crawlers and prefetch cannot bump it.
- [ ] Which key scope may bump: a new `counter` scope, so a public site key cannot write entries?
- [ ] Abuse control: per-IP or per-key rate limit, one vote per client token, max delta (1 or -1 only)?
- [ ] Should a counter change bump `updated_at`, revisions, content version and webhooks? Recommend no: it would break ETag caching on every view.
- [ ] Storage: separate `counters` table keyed by (entry, field), not inside entry JSON, so writes stay cheap and do not create revisions.
- [ ] Read path: include the count in the public read (extra join) or a separate cheap endpoint?
- [ ] Bench phase for the bump endpoint (single and concurrent) per project rule.

**Perf note**
- Views-count writes are hot. Batch in memory and flush on a timer, like the `last_used_at` throttle, if per-request writes cost too much.
