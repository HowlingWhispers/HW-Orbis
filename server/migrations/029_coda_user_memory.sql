BEGIN;

-- Coda's own memory of the people she talks to.
--
-- Scope of this schema: durable per-member state that Coda was explicitly told
-- to keep, or that an operator recorded. It is NOT a copy of Discord
-- surveillance (that remains in the public coda_surveillance_* tables for Big
-- Brother), and it is NOT a place for world or account data.
--
-- Three things are deliberately modelled separately, because collapsing them is
-- how a bot starts telling people things they never said:
--
--   profile     - a member's own stated details (name to call them, pronouns,
--                 likes/dislikes, timezone). Facts about the person.
--   memory      - a specific durable thing the member asked Coda to remember.
--                 The member opted in, and can correct or delete it.
--   perception  - something Coda has inferred. Never presented as something the
--                 member said, and never visible outside their DM by default.
--
-- Every row carries provenance and visibility:
--
--   provenance_type distinguishes 'the member said this' from 'Coda guessed
--   this' from 'an operator asserted this'. The prompt is built from that
--   distinction, and a correction replaces the content while keeping the row,
--   so "what she believes" and "what she used to believe" never get confused.
--
--   visibility is enforced on read, not just on write. 'private' rows are only
--   ever returned in the requesting member's own DM; they can never enter a
--   guild-channel prompt. That rule lives in server/coda-memory.ts and is
--   tested there, so it cannot be bypassed by adding a new query.
--
-- Deletion is soft by default with an audit row, because a member asking Coda to
-- forget something is a privacy request, and being able to answer "when was
-- this removed and who asked" afterwards is part of honouring it.

-- Postgres has no CREATE TYPE IF NOT EXISTS, so the enums are guarded
-- explicitly. This keeps the migration re-runnable, which matters because
-- migrations here are applied by hand with `psql -f` in numeric order.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'memory_visibility') THEN
    CREATE TYPE coda.memory_visibility AS ENUM ('private', 'shared', 'public');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'memory_provenance') THEN
    CREATE TYPE coda.memory_provenance AS ENUM ('member_stated', 'member_confirmed', 'coda_inferred', 'operator');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'memory_kind') THEN
    CREATE TYPE coda.memory_kind AS ENUM ('memory', 'perception');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS coda.member_profiles (
  orbis_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- How the member wants to be addressed. Not copied from Discord; this is a
  -- preference the member (or an operator) chose to store.
  preferred_name TEXT NOT NULL DEFAULT '',
  pronouns TEXT NOT NULL DEFAULT '',
  likes TEXT NOT NULL DEFAULT '',
  dislikes TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  coda_memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  provenance_type coda.memory_provenance NOT NULL DEFAULT 'member_stated',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE coda.member_profiles IS
  'Per-member profile details Coda was asked to keep. Nullable-free defaults so a profile can exist before anything is known.';

CREATE TABLE IF NOT EXISTS coda.member_notes (
  id BIGSERIAL PRIMARY KEY,
  orbis_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind coda.memory_kind NOT NULL DEFAULT 'memory',
  -- 'memory' rows the member asked Coda to keep. 'perception' rows are Coda's
  -- own inferences and are never presented as member statements.
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  visibility coda.memory_visibility NOT NULL DEFAULT 'private',
  provenance_type coda.memory_provenance NOT NULL DEFAULT 'member_stated',
  -- Where it came from: a Discord message id, a DM conversation, or an operator
  -- action. Nullable because an operator entry has no conversation.
  provenance_ref TEXT NOT NULL DEFAULT '',
  source_channel_id TEXT NOT NULL DEFAULT '',
  importance SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  -- A correction rewrites content in place and leaves this trail.
  revision_count INTEGER NOT NULL DEFAULT 0,
  corrected_from TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE coda.member_notes IS
  'Durable per-member notes Coda may use, with explicit provenance and visibility. Soft-deleted so a privacy request stays auditable.';

-- Every visibility change is enforced by read policy, but the hot read is
-- "this member's active notes", so that is the index that matters.
CREATE INDEX IF NOT EXISTS coda_member_notes_active_idx
  ON coda.member_notes (orbis_user_id, kind, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS coda_member_notes_expiry_idx
  ON coda.member_notes (expires_at)
  WHERE deleted_at IS NULL AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS coda_member_notes_pinned_idx
  ON coda.member_notes (orbis_user_id, pinned DESC, importance DESC)
  WHERE deleted_at IS NULL AND pinned;

-- Why a row exists is only trustworthy if changing it is recorded.
CREATE TABLE IF NOT EXISTS coda.member_note_audit (
  id BIGSERIAL PRIMARY KEY,
  note_id BIGINT NOT NULL,
  orbis_user_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'correct', 'revisibility', 'pin', 'delete', 'restore')),
  actor TEXT NOT NULL CHECK (actor IN ('member', 'coda', 'operator')),
  previous_content TEXT NOT NULL DEFAULT '',
  next_content TEXT NOT NULL DEFAULT '',
  previous_visibility TEXT NOT NULL DEFAULT '',
  next_visibility TEXT NOT NULL DEFAULT '',
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coda_member_note_audit_note_idx
  ON coda.member_note_audit (note_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS coda_member_note_audit_user_idx
  ON coda.member_note_audit (orbis_user_id, changed_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbis') THEN
    GRANT USAGE ON SCHEMA coda TO orbis;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA coda TO orbis;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA coda TO orbis;
  END IF;
END
$$;

COMMIT;