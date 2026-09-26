-- Per-user Coda debugging log. Every assistant request and every runtime execution is
-- recorded against the Orbis user who made it, so an administrator can reconstruct
-- exactly what Coda returned, what the runtime attempted, and what the database
-- actually did. Never store provider tokens or credentials.
CREATE TABLE IF NOT EXISTS coda_request_logs (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('assistant', 'execute')),
  mode text,
  model text,
  page_hint text,
  asset_id uuid,
  asset_name text,
  intent text,
  apply_operations boolean NOT NULL DEFAULT false,
  operation_count integer NOT NULL DEFAULT 0,
  saved_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('ok', 'partial', 'failed', 'refused', 'recovered')),
  duration_ms integer,
  input_chars integer,
  operations jsonb NOT NULL DEFAULT '[]'::jsonb,
  write_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  record_patch jsonb,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coda_request_logs_user_idx ON coda_request_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coda_request_logs_created_idx ON coda_request_logs (created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbis') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE coda_request_logs
      TO orbis;
    GRANT USAGE, SELECT
      ON SEQUENCE coda_request_logs_id_seq
      TO orbis;
  END IF;
END
$$;
