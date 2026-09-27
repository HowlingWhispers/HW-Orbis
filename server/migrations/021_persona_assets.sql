ALTER TABLE library_assets
  DROP CONSTRAINT IF EXISTS library_assets_type_check;

ALTER TABLE library_assets
  ADD CONSTRAINT library_assets_type_check
  CHECK (type IN ('world','persona','character','place','item','faction','species','society','family','memory'));
