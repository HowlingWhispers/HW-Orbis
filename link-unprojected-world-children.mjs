#!/usr/bin/env node
/**
 * Link canonical world children that exist in a world but are missing from that
 * world's compatibility projection.
 *
 * A canonical child is created with `origin_world_id` set, but the world
 * document's `locations` / `species` / `societies` / `factions` / `families` /
 * `memories` array does not always get the matching embedded entry. The record
 * then exists in Orbis, is counted in the world's dependency count, and is
 * invisible to the World Forge projection and to Speculus.
 *
 * This script is ADDITIVE ONLY. It never rewrites, renames, re-describes or
 * removes authored world content, and it never deletes a child. For each
 * unprojected child it performs exactly the same linking the running application
 * performs when a canonical child is mirrored into its world, so the result is
 * indistinguishable from a link made through the editor.
 *
 * DRY RUN IS THE DEFAULT. Nothing is written without --apply.
 *
 * Usage:
 *   DATABASE_URL=... npm run link:world-children
 *   DATABASE_URL=... npm run link:world-children -- --apply
 */

import { createPool } from './dist-server/db.js';
import { recordAssetRevision } from './dist-server/asset-writes.js';
import { mirrorCanonicalChildToWorld, worldCollectionKeyForType, worldCollectionSpecs } from './dist-server/world-entity-sync.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required. Refusing to guess a database.');
  process.exit(2);
}

const apply = process.argv.includes('--apply');
const pool = createPool(databaseUrl);
const worldCollectionTypes = worldCollectionSpecs.map((spec) => spec.type);

const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Children that are referenced by the world document are already linked and must
 * be left completely alone, so a second run of this script is a no-op.
 */
function isProjected(worldDocument, collectionKey, child) {
  const entries = Array.isArray(worldDocument[collectionKey]) ? worldDocument[collectionKey] : [];
  const childId = String(child.id);
  const childEntryId = text(object(child.document).worldEntryId);
  return entries.some((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    return text(raw.libraryAssetId) === childId || (childEntryId && text(raw.id) === childEntryId);
  });
}

async function main() {
  const worlds = await pool.query(
    `SELECT id, name, document
     FROM library_assets
     WHERE type = 'world'
     ORDER BY name, id`,
  );

  const plans = [];
  for (const world of worlds.rows) {
    const worldId = String(world.id);
    const worldName = String(world.name ?? worldId);
    const worldDocument = object(world.document);

    const children = await pool.query(
      `SELECT id, type, name, summary, origin_world_id, source_type, content_rating, visual_tone, document
       FROM library_assets
       WHERE origin_world_id = $1 AND type = ANY($2::text[])
       ORDER BY created_at, id`,
      [worldId, worldCollectionTypes],
    );

    for (const child of children.rows) {
      const collectionKey = worldCollectionKeyForType(String(child.type));
      if (!collectionKey) continue;
      if (isProjected(worldDocument, collectionKey, child)) continue;
      plans.push({
        worldId,
        worldName,
        collectionKey,
        childId: String(child.id),
        type: String(child.type),
        name: String(child.name ?? ''),
        summary: String(child.summary ?? ''),
        hasWorldEntryId: Boolean(text(object(child.document).worldEntryId)),
      });
    }
  }

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${plans.length} unprojected canonical child(ren) found across ${worlds.rowCount ?? 0} world(s).`);
  for (const plan of plans) {
    console.log(`LINK ${plan.worldName} / ${plan.collectionKey} / ${plan.name} (${plan.childId})`);
  }

  if (!plans.length) {
    console.log('Nothing to link. Every canonical world child is already projected.');
    return;
  }

  if (!apply) {
    console.log('Dry run only. Re-run with --apply after reviewing this exact plan and taking a fresh database backup.');
    return;
  }

  const byWorld = new Map();
  for (const plan of plans) {
    byWorld.set(plan.worldId, [...(byWorld.get(plan.worldId) ?? []), plan]);
  }

  let applied = 0;
  for (const [worldId, worldPlans] of byWorld) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT id FROM library_assets WHERE id = $1 AND type = 'world' FOR UPDATE`, [worldId]);

      // Re-read every child under the lock so a stale plan can never resurrect a
      // link that a concurrent editor already made or a delete already removed.
      const locked = await client.query(
        `SELECT id, type, name, summary, origin_world_id, source_type, content_rating, visual_tone, document
         FROM library_assets
         WHERE id = ANY($1::uuid[]) AND origin_world_id = $2
         ORDER BY id
         FOR UPDATE`,
        [worldPlans.map((plan) => plan.childId), worldId],
      );
      if (locked.rowCount !== worldPlans.length) {
        throw new Error(`${locked.rowCount ?? 0} of ${worldPlans.length} planned children changed or left this world; rolling back.`);
      }

      let changes = 0;
      for (const plan of worldPlans) {
        const row = locked.rows.find((entry) => String(entry.id) === plan.childId);
        if (!row) continue;
        const projection = await mirrorCanonicalChildToWorld(client, row);
        if (!projection.changed) continue;
        changes += 1;
        await recordAssetRevision(client, {
          assetId: worldId,
          operation: 'location-sync',
          source: 'system',
          changedFields: ['document'],
          documentBefore: projection.before,
          documentAfter: projection.after,
          performedBy: null,
        });
      }

      if (changes > 0) {
        await client.query(
          `UPDATE library_assets
           SET dependency_count = (SELECT count(*) FROM library_assets WHERE origin_world_id = $1)
           WHERE id = $1`,
          [worldId],
        );
      }
      await client.query('COMMIT');
      console.log(`LINKED ${worldPlans[0].worldName}: ${changes} projection(s) added.`);
      applied += changes;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error(`FAILED ${worldPlans[0].worldName}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    } finally {
      client.release();
    }
  }

  console.log(`Applied ${applied} world-child link(s).`);
}

try {
  await main();
} finally {
  await pool.end();
}
