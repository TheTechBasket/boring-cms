-- Identifiable icon per project: an emoji or an image URL. Empty = auto
-- initials avatar in the UI.
ALTER TABLE projects ADD COLUMN icon TEXT NOT NULL DEFAULT '';
