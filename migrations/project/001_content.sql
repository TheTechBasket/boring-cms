-- Content schema for a single project database.

CREATE TABLE collections (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '[]', -- JSON: [{ name, label, type }]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  slug TEXT NOT NULL, -- UUID
  status TEXT NOT NULL DEFAULT 'draft', -- draft | published
  data TEXT NOT NULL DEFAULT '{}',           -- JSON: current field values (markdown source)
  published_data TEXT,                        -- JSON: materialized snapshot served by the API
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  UNIQUE(collection_id, slug)
);

CREATE INDEX idx_entries_published
  ON entries (collection_id, status, published_at DESC);

CREATE TABLE revisions (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  changed TEXT NOT NULL, -- JSON backward delta: { field: previousValue } for changed fields only
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_revisions_entry ON revisions (entry_id, id DESC);

CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE, -- sha256 hex of the key; plaintext never stored
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO meta (key, value) VALUES ('content_version', '1');
