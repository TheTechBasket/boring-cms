-- MCP access is an opt-in capability per key, separate from read/write scope.
-- mcp = 0: key works only on the REST API. mcp = 1: key also works on the
-- /mcp/<project> endpoint, exposing read tools (read scope) or read + write
-- tools (write scope).
ALTER TABLE api_keys ADD COLUMN mcp INTEGER NOT NULL DEFAULT 0;
