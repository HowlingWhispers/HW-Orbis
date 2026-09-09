ALTER TABLE library_assets
  ADD COLUMN IF NOT EXISTS source_asset_id text,
  ADD COLUMN IF NOT EXISTS document jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS library_assets_source_identity_idx
  ON library_assets (source_type, source_asset_id)
  WHERE source_asset_id IS NOT NULL;
