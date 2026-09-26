-- Separate immutable creator provenance from the current controlling owner.
-- creator_user_id is retained as the operational owner column for compatibility
-- with the existing access layer; original_creator_user_id never changes.
ALTER TABLE library_assets
  ADD COLUMN IF NOT EXISTS original_creator_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

UPDATE library_assets
SET original_creator_user_id = creator_user_id
WHERE original_creator_user_id IS NULL
  AND creator_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION preserve_library_asset_original_creator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.original_creator_user_id IS NULL AND NEW.creator_user_id IS NOT NULL THEN
      NEW.original_creator_user_id := NEW.creator_user_id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.original_creator_user_id IS DISTINCT FROM OLD.original_creator_user_id THEN
    RAISE EXCEPTION 'original creator provenance is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS library_assets_preserve_original_creator ON library_assets;
CREATE TRIGGER library_assets_preserve_original_creator
BEFORE INSERT OR UPDATE ON library_assets
FOR EACH ROW
EXECUTE FUNCTION preserve_library_asset_original_creator();

CREATE INDEX IF NOT EXISTS library_assets_original_creator_idx
  ON library_assets (original_creator_user_id);

COMMENT ON COLUMN library_assets.creator_user_id IS
  'Current controlling owner. Legacy column name retained for compatibility; may change only through the explicit Orbis ownership-transfer flow.';
COMMENT ON COLUMN library_assets.original_creator_user_id IS
  'Immutable creator provenance. Set at record creation and never changed by ownership transfer; nullable only for legacy/system records that never had a user creator.';

CREATE TABLE IF NOT EXISTS library_world_ownership_transfers (
  id bigserial PRIMARY KEY,
  world_id uuid NOT NULL,
  world_name text NOT NULL,
  from_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  to_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  transferred_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  child_count integer NOT NULL DEFAULT 0 CHECK (child_count >= 0),
  transferred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_world_ownership_transfers_world_idx
  ON library_world_ownership_transfers (world_id, transferred_at DESC);
CREATE INDEX IF NOT EXISTS library_world_ownership_transfers_users_idx
  ON library_world_ownership_transfers (from_user_id, to_user_id, transferred_at DESC);
