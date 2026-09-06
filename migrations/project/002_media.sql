-- Media library per project. Files live in a storage backend (local disk or
-- S3-compatible); this table is the index. Keys are content-hash prefixed so
-- serve responses can be cached as immutable.

CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,           -- original upload name
  key TEXT NOT NULL UNIQUE,         -- <hash8>-<slug>.<ext>
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  variants TEXT NOT NULL DEFAULT '{}', -- JSON: { thumb: key, medium: key }
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
