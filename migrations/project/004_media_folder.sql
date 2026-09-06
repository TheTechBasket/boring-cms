-- Free-text media group ("featured", "logos", "temp"...). Empty = ungrouped.
ALTER TABLE media ADD COLUMN folder TEXT NOT NULL DEFAULT '';
