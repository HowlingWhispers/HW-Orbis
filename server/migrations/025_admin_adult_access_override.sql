-- Per-account adult access override for administration and testing.
--
-- Why this column exists and why it is NOT `users.can_view_adult`:
--
-- `can_view_adult` is a CACHE of the last Discord role evaluation. The access
-- middleware overwrites it wholesale on every evaluation (`requireCreator` and
-- the `/me` handler both write `access.canViewAdult` back into this row). Any
-- value written there by hand is therefore destroyed within ACCESS_MAX_AGE_MS
-- or on the next sign-in, silently. An operator would flip it, see the adult
-- tab appear once, and watch it vanish with no error.
--
-- So the override lives in its own column that the refresh path never writes.
-- The access path ORs this value in AFTER the Discord evaluation, making it a
-- second source of truth rather than a competing value in a cache.
--
-- This is deliberately an ESCALATION and not a relaxation. It can only ever
-- turn adult viewing ON for one named account. It can never revoke Discord
-- grants, cannot affect creation or administration, and defaults to false.
ALTER TABLE users ADD COLUMN IF NOT EXISTS adult_access_override boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.adult_access_override IS
  'Per-account adult viewing grant set by a super-admin for testing/recovery. Read by the access path and ORed in after Discord evaluation. Never written by the access refresh, so unlike can_view_adult it is not a cache. Escalation only: it can grant adult viewing, never revoke a Discord grant or affect creation/administration.';

-- Who granted an adult override, when, and whether they took it back.
-- This is an access-control grant on a protected-content boundary, so it is
-- audited on the same standard as admin settings changes. Without this record
-- there is no way to answer "who could see adult content, and who authorised
-- it" after the fact.
CREATE TABLE IF NOT EXISTS adult_access_override_audit (
  id bigserial PRIMARY KEY,
  target_user_id uuid NOT NULL,
  granted boolean NOT NULL,
  changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS adult_access_override_audit_changed_at_idx
  ON adult_access_override_audit (changed_at DESC);

-- Partial index: the admin panel lists only accounts that currently hold an
-- override, which is a tiny set compared to the whole user table.
CREATE INDEX IF NOT EXISTS users_adult_access_override_idx
  ON users (display_name) WHERE adult_access_override;

COMMENT ON TABLE adult_access_override_audit IS
  'History of per-account adult viewing grants and revocations. Retained after the user row is deleted so a grant on a removed account is still attributable.';
