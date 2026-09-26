#!/usr/bin/env node
/**
 * One-time/backfill migration for world-contained library records.
 *
 * Run after `npm run build:api` so the compiled sync helpers exist:
 *   DATABASE_URL=... node migrate-world-entities.mjs
 *
 * Safe to rerun: existing worldEntryId/libraryAssetId links are reused.
 */

import { createPool } from './dist-server/db.js';
import { syncWorldLocations } from './dist-server/asset-writes.js';
import { syncWorldEmbeddedEntities } from './dist-server/world-entity-sync.js';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/orbis';
const pool = createPool(databaseUrl);

async function main() {
  const worlds = await pool.query(
    `SELECT id, name, creator_user_id, content_rating, document
     FROM library_assets
     WHERE type = 'world'
     ORDER BY name`,
  );

  console.log(`Found ${worlds.rowCount ?? 0} worlds to synchronize.`);
  let failures = 0;

  for (const world of worlds.rows) {
    const worldId = String(world.id);
    const name = String(world.name ?? worldId);
    const userId = String(world.creator_user_id ?? '');
    const contentRating = String(world.content_rating ?? 'sfw');
    const document = world.document && typeof world.document === 'object' && !Array.isArray(world.document)
      ? world.document
      : {};

    if (!userId) {
      console.warn(`${name}: skipped because the world has no creator_user_id.`);
      failures += 1;
      continue;
    }

    try {
      await syncWorldLocations(pool, worldId, userId, document, contentRating);
      const result = await syncWorldEmbeddedEntities(
        pool,
        worldId,
        userId,
        document,
        contentRating,
      );
      console.log(`${name}: created ${result.created}, updated ${result.updated}, linked ${result.linked}, warnings ${result.errors.length}.`);
      if (result.errors.length) failures += 1;
    } catch (error) {
      failures += 1;
      console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await pool.end();
  if (failures) {
    console.error(`Backfill completed with ${failures} world(s) reporting warnings/errors.`);
    process.exit(1);
  }
  console.log('World entity backfill complete.');
}

main().catch(async (error) => {
  console.error('World entity backfill failed:', error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
