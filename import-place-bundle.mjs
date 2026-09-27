#!/usr/bin/env node
/**
 * Import a private place bundle as a world plus canonical children.
 *
 * All of the logic lives in server/import-place-bundle.ts so it can be tested
 * without a database. This file only reads the payload, opens one transaction
 * for the whole import, and reports the result.
 *
 *   DATABASE_URL=... node import-place-bundle.mjs <bundle.json> [ownerDiscordId]
 *
 * The import is idempotent: re-running it re-derives the same source ids and
 * changes nothing. It never overwrites an existing world document, so a re-run
 * cannot destroy projection links or newer authored world state.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import pg from 'pg';
import { importPlaceBundle } from './dist-server/import-place-bundle.js';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Refusing to guess a database.');
  process.exit(1);
}

const payloadPath = process.argv[2];
if (!payloadPath) {
  console.error('Usage: node import-place-bundle.mjs <bundle.json> [ownerDiscordId]');
  process.exit(1);
}

const ownerDiscordId = process.argv[3];
const pool = new Pool({ connectionString: DATABASE_URL });
const client = await pool.connect();

try {
  // One transaction for the world, its children and the projection. A failure
  // rolls the whole unit back instead of leaving children without a world link.
  await client.query('BEGIN');

  const ownerResult = await client.query('SELECT id FROM users WHERE discord_id = $1', [ownerDiscordId ?? '']);
  if (!ownerResult.rowCount) {
    throw new Error(`No Orbis user is bound to Discord id ${ownerDiscordId ?? '(not supplied)'}.`);
  }
  const userId = String(ownerResult.rows[0].id);

  const bundle = JSON.parse(await readFile(payloadPath, 'utf8'));
  const result = await importPlaceBundle(client, bundle, { userId });

  await client.query('COMMIT');

  console.log(`Imported ${basename(payloadPath)}`);
  console.log(`  world        ${result.worldId}${result.worldCreated ? ' (created)' : ' (already existed, left untouched)'}`);
  console.log(`  children     ${result.childrenCreated} created, ${result.childrenExisting} already present`);
  console.log(`  projection   ${result.projectionLinked} linked entries`);
  console.log('Re-running this import changes nothing.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`Import failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
