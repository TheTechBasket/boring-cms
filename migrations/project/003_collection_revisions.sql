-- Per-collection revision retention. NULL = default keep, 0 = revisions off.
ALTER TABLE collections ADD COLUMN revisions_keep INTEGER;
