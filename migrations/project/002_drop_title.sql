-- Entries no longer have a built-in title. Identity is a UUID slug; the
-- admin lists entries by their first field's value instead.

ALTER TABLE entries DROP COLUMN title;
