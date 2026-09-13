-- Additive account preference. Does not alter assets, grants or V1 sessions.
CREATE TABLE IF NOT EXISTS user_simulation_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  engine text NOT NULL DEFAULT 'v1' CHECK (engine IN ('v1', 'v2')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
