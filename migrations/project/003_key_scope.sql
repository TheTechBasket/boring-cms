-- API key scope: 'read' (published content only) or 'write' (MCP mutating
-- tools). Existing keys stay read-only.

ALTER TABLE api_keys ADD COLUMN scope TEXT NOT NULL DEFAULT 'read';
