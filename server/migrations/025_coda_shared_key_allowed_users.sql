-- Per-owner allow list for the Discord Coda shared-provider pool.
--
-- Consent here is deliberately narrow. A blanket opt-in means "any Discord
-- member may generate from my connection", which is a much larger thing to
-- agree to than naming the people you trust. This table records exactly that:
-- the owner of a pooled credential names the Discord accounts whose requests it
-- may answer.
--
-- Stores Discord snowflakes only. No credential material, and no Orbis account
-- data beyond the owner's own user id, which already owns the row.
CREATE TABLE IF NOT EXISTS coda_shared_key_allowed_users (
  owner_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The Discord account permitted to be served by this owner's credential.
  -- Deliberately not a foreign key: the permitted party may be an unlinked
  -- guest who has never created an Orbis account.
  discord_user_id text NOT NULL CHECK (discord_user_id ~ '^[0-9]{17,20}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, discord_user_id)
);

COMMENT ON TABLE coda_shared_key_allowed_users IS
  'Discord accounts each pool owner permits to be served by their credential. Empty list means the credential serves nobody.';
COMMENT ON COLUMN coda_shared_key_allowed_users.discord_user_id IS
  'Discord snowflake of an allowed account. May be an unlinked guest, so it is intentionally not a users foreign key.';

-- The selector asks "which owners allow this requester?", so index by the
-- requester rather than the owner.
CREATE INDEX IF NOT EXISTS coda_shared_key_allowed_users_discord_idx
  ON coda_shared_key_allowed_users (discord_user_id);
