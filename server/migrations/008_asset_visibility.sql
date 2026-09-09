ALTER TABLE library_assets
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'library_assets_visibility_check'
  ) THEN
    ALTER TABLE library_assets
      ADD CONSTRAINT library_assets_visibility_check
      CHECK (visibility IN ('public', 'private'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS library_assets_visibility_owner_idx
  ON library_assets (visibility, creator_user_id, updated_at DESC);
