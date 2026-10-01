BEGIN;

-- New Coda-owned persistence starts here. Existing public.coda_* tables remain
-- in place until each has an explicit compatibility and rollback migration.
CREATE SCHEMA IF NOT EXISTS coda;

COMMENT ON SCHEMA coda IS
  'Durable Coda workflow, retrieval, preference, social-context, and audit state. Canonical Orbis world, ownership, permission, and user records do not belong here.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbis') THEN
    GRANT USAGE ON SCHEMA coda TO orbis;
  END IF;
END
$$;

COMMIT;
