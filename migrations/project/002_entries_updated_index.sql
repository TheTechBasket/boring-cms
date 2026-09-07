-- Speeds up the admin entries list (ORDER BY updated_at, paginated).
CREATE INDEX idx_entries_updated
  ON entries (collection_id, updated_at DESC);
