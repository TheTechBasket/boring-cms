-- After a successful migration the old copy stays on the previous storage.
-- Remember where it was ('' = local disk) so the cleanup action can check
-- it still exists and delete it on demand. NULL = no old copy pending.
ALTER TABLE media ADD COLUMN migrated_from TEXT;
