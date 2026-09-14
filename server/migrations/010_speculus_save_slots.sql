ALTER TABLE speculus_saves
  ADD COLUMN IF NOT EXISTS save_kind text NOT NULL DEFAULT 'snapshot',
  ADD COLUMN IF NOT EXISTS autosave_key text;

ALTER TABLE speculus_saves
  DROP CONSTRAINT IF EXISTS speculus_saves_save_kind_check;

ALTER TABLE speculus_saves
  ADD CONSTRAINT speculus_saves_save_kind_check
  CHECK (save_kind IN ('autosave', 'snapshot'));

CREATE UNIQUE INDEX IF NOT EXISTS speculus_saves_autosave_key_idx
  ON speculus_saves (user_id, autosave_key)
  WHERE save_kind = 'autosave' AND autosave_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS speculus_saves_kind_idx
  ON speculus_saves (user_id, world_id, save_kind, updated_at DESC);
