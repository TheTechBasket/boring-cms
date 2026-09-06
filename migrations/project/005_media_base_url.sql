-- Where each file actually lives. NULL = follows the project's current
-- storage. When the project switches storage, existing rows get pinned to
-- the base they were uploaded under ('' = app-served local disk), so their
-- URLs keep working until "Migrate media" copies them over.
ALTER TABLE media ADD COLUMN base_url TEXT;
