-- Per-account acknowledgement of the public Orbis changelog.
--
-- This is a presentation preference only. It records which public changelog
-- version an account has already seen, so the "What's New" notice appears once
-- per release rather than on every visit. It grants no permission, changes no
-- ownership, privacy or publication state, and is safe to delete.
--
-- Acknowledgement is deliberately account-backed rather than per-browser: a
-- member who reads an update on one device should not be shown it again on
-- another.
CREATE TABLE IF NOT EXISTS user_changelog_state (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Monotonic `YYYY.MM.DD.N` version from server/public-changelog.ts.
  -- Never derived from displayed date text.
  acknowledged_version text NOT NULL DEFAULT '',
  acknowledged_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_changelog_state IS
  'Which public Orbis changelog version an account has acknowledged. Presentation preference only; grants nothing.';
COMMENT ON COLUMN user_changelog_state.acknowledged_version IS
  'Monotonic changelog version. Compared against the published version, not against displayed date text.';
