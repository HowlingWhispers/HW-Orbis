ALTER TABLE library_assets DROP CONSTRAINT IF EXISTS library_assets_type_check;
ALTER TABLE library_assets ADD CONSTRAINT library_assets_type_check
  CHECK (type IN ('world','character','place','item','faction','species','society','family','memory'));

CREATE TABLE IF NOT EXISTS user_provider_settings (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('novelai')),
  token_ciphertext bytea NOT NULL,
  token_iv bytea NOT NULL,
  token_tag bytea NOT NULL,
  model text NOT NULL DEFAULT 'xialong-v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

CREATE TABLE IF NOT EXISTS generation_grants (
  token_hash text PRIMARY KEY,
  launch_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
  asset_type text NOT NULL CHECK (asset_type IN ('character','world','place','item','faction','other')),
  asset_revision text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generation_grants_active_idx
  ON generation_grants (expires_at)
  WHERE revoked_at IS NULL;
