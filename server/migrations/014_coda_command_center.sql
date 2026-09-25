ALTER TABLE coda_discord_messages
  ADD COLUMN IF NOT EXISTS destination_type text NOT NULL DEFAULT 'channel' CHECK (destination_type IN ('channel', 'dm')),
  ADD COLUMN IF NOT EXISTS recipient_user_id text,
  ADD COLUMN IF NOT EXISTS recipient_display_name text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS coda_control_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  outbound_enabled boolean NOT NULL DEFAULT true,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO coda_control_state (singleton, outbound_enabled)
VALUES (true, true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS coda_message_templates (
  id bigserial PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coda_message_templates_name_idx
  ON coda_message_templates (lower(name));

CREATE TABLE IF NOT EXISTS coda_scheduled_messages (
  id bigserial PRIMARY KEY,
  destination_type text NOT NULL CHECK (destination_type IN ('channel', 'dm')),
  target_id text NOT NULL,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  reply_to text NOT NULL DEFAULT '',
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'cancelled', 'failed')),
  last_error text,
  sent_discord_message_id text,
  sent_message_audit_id bigint REFERENCES coda_discord_messages(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coda_scheduled_messages_due_idx
  ON coda_scheduled_messages (status, send_at);

CREATE INDEX IF NOT EXISTS coda_scheduled_messages_actor_idx
  ON coda_scheduled_messages (created_by_user_id, created_at DESC);
