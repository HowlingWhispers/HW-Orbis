BEGIN;

CREATE TABLE IF NOT EXISTS coda_office_reading_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  discord_user_id TEXT NOT NULL CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
  guild_id TEXT CHECK (guild_id IS NULL OR guild_id ~ '^[0-9]{17,20}$'),
  channel_id TEXT NOT NULL CHECK (channel_id ~ '^[0-9]{17,20}$'),
  message_id TEXT NOT NULL CHECK (message_id ~ '^[0-9]{17,20}$'),
  attachment_name TEXT NOT NULL CHECK (char_length(attachment_name) BETWEEN 1 AND 300),
  attachment_hash TEXT NOT NULL CHECK (attachment_hash ~ '^[a-f0-9]{64}$'),
  content_type TEXT NOT NULL DEFAULT '' CHECK (char_length(content_type) <= 200),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  source_text TEXT NOT NULL CHECK (char_length(source_text) BETWEEN 1 AND 2000000),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'reading', 'ready', 'failed')),
  chunks JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ,
  error_message TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'waiting' CHECK (delivery_status IN ('waiting', 'pending', 'delivering', 'delivered')),
  delivery_lease_expires_at TIMESTAMPTZ,
  completion_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS coda_office_reading_message_attachment_idx
  ON coda_office_reading_jobs (message_id, attachment_hash);
CREATE INDEX IF NOT EXISTS coda_office_reading_claim_idx
  ON coda_office_reading_jobs (available_at, created_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS coda_office_reading_delivery_idx
  ON coda_office_reading_jobs (updated_at)
  WHERE status = 'ready' AND delivery_status = 'pending';
CREATE INDEX IF NOT EXISTS coda_office_reading_context_idx
  ON coda_office_reading_jobs (discord_user_id, channel_id, finished_at DESC)
  WHERE status = 'ready';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbis') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE coda_office_reading_jobs TO orbis;
  END IF;
END
$$;

COMMIT;
