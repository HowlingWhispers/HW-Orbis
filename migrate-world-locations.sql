-- RETIRED. Do not run this file.
--
-- This was a second, hand-written implementation of the embedded-location
-- migration. It has been replaced by:
--
--     npm run migrate:world-locations
--     DATABASE_URL=... node migrate-world-locations.mjs [--dry-run] [worldId]
--
-- The implementation lives in server/migrate-world-locations.ts, which delegates
-- to the same sync the editor and Coda use.
--
-- It was retired because of two defects:
--
--   1. It copied only three fields (kind, parentLocationId, description) into each
--      new place document, discarding every other authored field on the location.
--   2. Its per-location EXCEPTION handler caught a failure after the place row was
--      inserted but before the world's back-link was written, logged it, counted an
--      error, and continued. The function was called in a single transaction, but
--      the handler swallowed the error rather than aborting, so the run completed
--      leaving place rows with origin_world_id set and no libraryAssetId pointing
--      back at them. That is the orphan shape: canonical children that the world's
--      collections do not reference.
--
-- It also replaced the whole document on conflict, which could overwrite
-- authored world state on a re-run.
--
-- The maintained script performs the whole migration for one world inside a
-- transaction, copies the authored location entry whole, reuses Orbis's own
-- projection layer, and reports rather than swallowing a malformed collection.

DO $$
BEGIN
  RAISE EXCEPTION
    'migrate-world-locations.sql has been retired. Run: node migrate-world-locations.mjs (--dry-run to preview).';
END
$$;
