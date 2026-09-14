CREATE TABLE IF NOT EXISTS speculus_saves (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  world_id uuid REFERENCES library_assets(id) ON DELETE SET NULL,
  world_name text NOT NULL,
  source_asset_id uuid NOT NULL,
  source_type text NOT NULL,
  source_revision text NOT NULL,
  source_name text NOT NULL,
  title text NOT NULL,
  character_id text,
  character_name text,
  location_id text,
  location_name text,
  elapsed_seconds bigint NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  turn_count integer NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
  save_format text NOT NULL DEFAULT 'speculus-v2-session',
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS speculus_saves_user_world_idx
  ON speculus_saves (user_id, world_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS speculus_saves_user_recent_idx
  ON speculus_saves (user_id, updated_at DESC);
