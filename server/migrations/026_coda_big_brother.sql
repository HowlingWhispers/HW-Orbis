BEGIN;

CREATE TABLE IF NOT EXISTS coda_surveillance_messages (
  discord_message_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  author_username TEXT NOT NULL DEFAULT '',
  author_bot BOOLEAN NOT NULL DEFAULT FALSE,
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  reply_to_message_id TEXT,
  message_created_at TIMESTAMPTZ NOT NULL,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coda_surveillance_messages_guild_time_idx
  ON coda_surveillance_messages (guild_id, message_created_at DESC);
CREATE INDEX IF NOT EXISTS coda_surveillance_messages_channel_time_idx
  ON coda_surveillance_messages (channel_id, message_created_at DESC);
CREATE INDEX IF NOT EXISTS coda_surveillance_messages_author_time_idx
  ON coda_surveillance_messages (author_id, message_created_at DESC);
CREATE INDEX IF NOT EXISTS coda_surveillance_messages_active_time_idx
  ON coda_surveillance_messages (message_created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS coda_surveillance_revisions (
  id BIGSERIAL PRIMARY KEY,
  discord_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('create', 'edit', 'delete')),
  content TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coda_surveillance_revisions_message_idx
  ON coda_surveillance_revisions (discord_message_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS coda_surveillance_memories (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'server' CHECK (scope IN ('server', 'user', 'channel', 'message')),
  subject_user_id TEXT,
  channel_id TEXT,
  source_message_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  importance SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coda_surveillance_memories_guild_idx
  ON coda_surveillance_memories (guild_id, pinned DESC, importance DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS coda_surveillance_memories_subject_idx
  ON coda_surveillance_memories (subject_user_id, updated_at DESC)
  WHERE subject_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS coda_surveillance_memories_channel_idx
  ON coda_surveillance_memories (channel_id, updated_at DESC)
  WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS coda_surveillance_memories_source_idx
  ON coda_surveillance_memories (source_message_id, updated_at DESC)
  WHERE source_message_id IS NOT NULL;

COMMIT;
