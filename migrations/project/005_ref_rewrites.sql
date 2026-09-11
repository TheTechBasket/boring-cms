-- Audit trail for bulk_rewrite_refs: a cosmetic ref swap bypasses the normal
-- edit trail (it does not touch updated_at), so each live run is logged here
-- instead. Dry runs are not recorded (they change nothing). pairs is the JSON
-- array of {old,new} that ran, kept for forensics.
CREATE TABLE ref_rewrites (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  pair_count INTEGER NOT NULL,
  entries_touched INTEGER NOT NULL,
  pairs TEXT NOT NULL
);
