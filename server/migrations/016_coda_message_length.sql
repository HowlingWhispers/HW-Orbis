-- Coda Discord messages: this guild is boosted, so Discord accepts 4000 characters
-- per message instead of 2000. Orbis also stores a longer composed message so the
-- console can split it into several Discord posts.
ALTER TABLE coda_discord_messages
  DROP CONSTRAINT IF EXISTS coda_discord_messages_content_check;
ALTER TABLE coda_discord_messages
  ADD CONSTRAINT coda_discord_messages_content_check
  CHECK (char_length(content) BETWEEN 1 AND 12000);

ALTER TABLE coda_message_templates
  DROP CONSTRAINT IF EXISTS coda_message_templates_content_check;
ALTER TABLE coda_message_templates
  ADD CONSTRAINT coda_message_templates_content_check
  CHECK (char_length(content) BETWEEN 1 AND 12000);

ALTER TABLE coda_scheduled_messages
  DROP CONSTRAINT IF EXISTS coda_scheduled_messages_content_check;
ALTER TABLE coda_scheduled_messages
  ADD CONSTRAINT coda_scheduled_messages_content_check
  CHECK (char_length(content) BETWEEN 1 AND 12000);

-- Administrator switch: send oversized messages as several Discord posts.
ALTER TABLE coda_control_state
  ADD COLUMN IF NOT EXISTS split_long_messages boolean NOT NULL DEFAULT true;
