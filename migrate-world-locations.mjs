#!/usr/bin/env node
/**
 * Promote embedded world locations to canonical, linked `place` rows.
 *
 * All of the logic lives in server/migrate-world-locations.ts so it can be
 * tested without a database. Each world is migrated in its own transaction, so a
 * failure rolls that world back completely instead of leaving a place row
 * committed without the world's back-link.
 *
 *   DATABASE_URL=... node migrate-world-locations.mjs [--dry-run] [worldId]
 *
 * With no worldId every world is processed. The migration is idempotent: a
 * location that already carries a libraryAssetId is left alone.
 */

import pg from 'pg';
import { migrateWorldLocations } from './dist-server/migrate-world-locations.js';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Refusing to guess a database.');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const onlyWorldId = process.argv.slice(2).find((argument) => !argument.startsWith('--'));

const pool = new Pool({ connectionString: DATABASE_URL });
let failed = false;

try {
  const worlds = onlyWorldId
    ? (await pool.query('SELECT id, name FROM library_assets WHERE type = \'world\' AND id = $1', [onlyWorldId]))
    : (await pool.query("SELECT id, name FROM library_assets WHERE type = 'world' ORDER BY name"));
  console.log(`Found ${worlds.rowCount} world(s)${dryRun ? ' (dry run — nothing will be written)' : ''}`);

  for (const world of worlds.rows) {
    const client = await pool.connect();
    try {
      await client.query(dryRun ? 'BEGIN' : 'BEGIN');
      const result = await migrateWorldLocations(client, String(world.id), { dryRun });
      if (dryRun) await client.query('ROLLBACK');
      else await client.query('COMMIT');

      console.log(`\n${world.name} (${world.id})`);
      if (dryRun) {
        console.log(`  would create/link ${result.planned ?? 0} location(s); ${result.alreadyLinked} already linked`);
      } else {
        console.log(`  created ${result.created}, updated ${result.updated}, linked ${result.linked}; ${result.alreadyLinked} already linked`);
      }
      for (const issue of result.errors) {
        console.error(`  refused: ${issue}`);
        failed = true;
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`\n${world.name} (${world.id}) rolled back: ${error instanceof Error ? error.message : String(error)}`);
      failed = true;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}

process.exit(failed ? 1 : 0);
