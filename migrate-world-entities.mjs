#!/usr/bin/env node
/**
 * One-time/backfill migration for world-contained library records.
 *
 * Run after `npm run build:api` so the compiled helpers exist:
 *   DATABASE_URL=... node migrate-world-entities.mjs
 *
 * This migration is intentionally conservative:
 * - DATABASE_URL is mandatory; there is no fallback database.
 * - each world is one transaction;
 * - exact IDs are preferred;
 * - legacy name matching is allowed only here;
 * - ambiguous names abort that world's transaction instead of creating a twin.
 */

import { createPool } from './dist-server/db.js';
import { rebuildWorldProjection, syncWorldEmbeddedEntities } from './dist-server/world-entity-sync.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required. Refusing to guess a database.');
  process.exit(2);
}

const pool = createPool(databaseUrl);

async function main() {
  const worlds = await pool.query(
    `SELECT id, name, creator_user_id, content_rating, document
     FROM library_assets
     WHERE type = 'world'
     ORDER BY name, id`,
  );

  console.log(`Found ${worlds.rowCount ?? 0} worlds to synchronize.`);
  let failures = 0;

  for (const world of worlds.rows) {
    const worldId = String(world.id);
    const name = String(world.name ?? worldId);
    const userId = String(world.creator_user_id ?? '');
    const contentRating = String(world.content_rating ?? 'sfw');
    const document = world.document && typeof world.document === 'object' && !Array.isArray(world.document)
      ? structuredClone(world.document)
      : {};

    if (!userId) {
      console.warn(`${name}: skipped because the world has no creator_user_id.`);
      failures += 1;
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM library_assets WHERE id = $1 FOR UPDATE', [worldId]);
      const result = await syncWorldEmbeddedEntities(
        client,
        worldId,
        userId,
        document,
        contentRating,
        { allowLegacyNameMatch: true, strict: true },
      );
      await rebuildWorldProjection(client, worldId, { dropUnlinked: false });
      await client.query('COMMIT');
      console.log(`${name}: created ${result.created}, updated ${result.updated}, linked ${result.linked}.`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      failures += 1;
      console.error(`${name}: rolled back — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }

  await pool.end();
  if (failures) {
    console.error(`Backfill completed with ${failures} world(s) rolled back/skipped.`);
    process.exit(1);
  }
  console.log('World entity backfill complete.');
}

main().catch(async (error) => {
  console.error('World entity backfill failed:', error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
