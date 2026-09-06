# Stage 6: MCP per project

**Goal**

Each project exposes an MCP endpoint so agents can read and write its content with an API key. The CMS becomes agent-operable per site.

**Decisions**

- Transport: Streamable HTTP at `POST /mcp/:project`, JSON-RPC 2.0 hand-rolled (initialize, tools/list, tools/call). No SDK dependency; the protocol surface we need is small. SSE streaming only if a client demands it, plain JSON responses first.
- Auth: same Bearer API keys as the REST API. Keys gain a `scope` column: `read` (default, existing keys) or `write`. Write scope unlocks mutating tools.
- Read tools: `list_collections`, `list_entries` (published, paginated), `get_entry`.
- Write tools (write scope): `create_entry`, `update_entry` (goes through the same delta-revision path as the UI, so agent edits are revertable), `publish_entry`, `unpublish_entry`.
- Tool results are the same materialized JSON the REST API serves; one content shape everywhere.
- Admin UI: API keys page grows a scope select on create and shows each key's scope; MCP endpoint URL with a copyable client config snippet shown on the project page.
- Rate limit: simple per-key token bucket in memory (N requests/min) to keep an agent loop from hammering SQLite; 429 with retry-after.

**Checklist**

- [ ] migrations/project/00X_key_scope.sql (scope column, default read).
- [ ] lib/mcp.ts: JSON-RPC plumbing, initialize/tools list/call dispatch, error mapping.
- [ ] Read tools wired to the existing published read path.
- [ ] Write tools wired through lib/content.ts (revisions intact), gated on write scope.
- [ ] Per-key rate limiting.
- [ ] API keys UI scope select; project page MCP config snippet.
- [ ] Smoke: initialize handshake, tools/list, read tool with read key, write tool rejected with read key and accepted with write key, revision created by agent edit.
- [ ] README MCP section with a Claude Code `.mcp.json` example.

**Verification**

- pnpm smoke green.
- Manual: add the endpoint to Claude Code via .mcp.json, list and edit entries from a session, revert the agent's edit from the admin UI.
