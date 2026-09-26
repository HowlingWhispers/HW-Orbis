-- Coda's runtime needs a real change record so a write confirmation can name a
-- revision instead of claiming "saved" without evidence. Every asset write
-- (editor save or Coda operation) appends one row here.
CREATE TABLE IF NOT EXISTS library_asset_revisions (
  id bigserial PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'location-sync')),
  source text NOT NULL DEFAULT 'editor' CHECK (source IN ('editor', 'coda', 'import', 'system')),
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_before jsonb,
  document_after jsonb,
  performed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, revision)
);

CREATE INDEX IF NOT EXISTS library_asset_revisions_asset_idx
  ON library_asset_revisions (asset_id, revision DESC);

-- The runtime role owns writes but never revision rows, so it needs the same table
-- grants the other Coda tables already have.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbis') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE library_asset_revisions
      TO orbis;
    GRANT USAGE, SELECT
      ON SEQUENCE library_asset_revisions_id_seq
      TO orbis;
  END IF;
END
$$;
