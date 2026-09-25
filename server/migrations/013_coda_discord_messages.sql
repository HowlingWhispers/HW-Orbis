CREATE TABLE IF NOT EXISTS coda_discord_messages (
  id bigserial PRIMARY KEY,
  sent_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  discord_message_id text UNIQUE,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  reply_to_message_id text,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coda_discord_messages_created_at_idx
  ON coda_discord_messages (created_at DESC);

CREATE INDEX IF NOT EXISTS coda_discord_messages_actor_idx
  ON coda_discord_messages (sent_by_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS coda_discord_messages_channel_idx
  ON coda_discord_messages (channel_id, created_at DESC);
