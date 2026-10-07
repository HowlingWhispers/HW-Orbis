CREATE TABLE IF NOT EXISTS admin_provider_credentials (
  provider text PRIMARY KEY CHECK (provider IN ('openai')),
  secret_ciphertext bytea NOT NULL,
  secret_iv bytea NOT NULL,
  secret_tag bytea NOT NULL,
  model text NOT NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE admin_provider_credentials IS
  'Write-only, encrypted provider credentials managed by the Orbis super-administrator for server workloads.';
