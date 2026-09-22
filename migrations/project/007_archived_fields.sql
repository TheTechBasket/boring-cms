-- Removed fields land here instead of being deleted outright, so the exact
-- definition (type, constraints) can be restored without retyping it.
ALTER TABLE collections ADD COLUMN archived_fields TEXT NOT NULL DEFAULT '[]';
