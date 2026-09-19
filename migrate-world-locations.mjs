#!/usr/bin/env node
/**
 * Migration script to promote embedded world locations to linked library place assets.
 * Run once after deploying the library location sync feature.
 */

import pg from 'pg';
import { randomUUID } from 'node:crypto';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@localhost:5432/orbis';

const pool = new Pool({ connectionString: DATABASE_URL });

async function migrateWorld(worldId) {
  const client = await pool.connect();
  try {
    const worldResult = await client.query('SELECT document FROM library_assets WHERE id = $1 AND type = $2', [worldId, 'world']);
    if (!worldResult.rowCount) {
      console.log(`World ${worldId} not found`);
      return { migrated: 0, errors: [] };
    }

    const document = worldResult.rows[0].document ?? {};
    const rawLocations = document.locations;
    if (!Array.isArray(rawLocations) || rawLocations.length === 0) {
      console.log(`World ${worldId}: no embedded locations`);
      return { migrated: 0, errors: [] };
    }

    const locations = rawLocations
      .map((loc, idx) => {
        if (!loc || typeof loc.id !== 'string' || typeof loc.name !== 'string') {
          console.warn(`World ${worldId}: location at index ${idx} missing id or name`);
          return null;
        }
        return {
          id: loc.id,
          name: loc.name,
          kind: loc.kind ?? 'region',
          description: loc.description ?? '',
          parentLocationId: loc.parentLocationId ?? null,
          libraryAssetId: loc.libraryAssetId ?? null,
        };
      })
      .filter((loc) => loc !== null);

    let migrated = 0;
    const errors = [];

    for (const loc of locations) {
      let placeId = loc.libraryAssetId;
      const placeDocument = {
        kind: loc.kind,
        parentLocationId: loc.parentLocationId,
        description: loc.description,
      };

      try {
        if (placeId) {
          const existing = await client.query('SELECT id FROM library_assets WHERE id = $1 AND type = $2 AND origin_world_id = $3', [placeId, 'place', worldId]);
          if (!existing.rowCount) {
            console.warn(`World ${worldId}: location "${loc.name}" (${loc.id}) references missing place asset ${placeId}; creating new`);
            placeId = null;
          }
        }

        if (!placeId) {
          const created = await client.query(
            `INSERT INTO library_assets (id, type, name, summary, origin_world_id, creator_user_id, source_type, content_rating, tags, visual_tone, document)
             VALUES ($1, $2, $3, $4, $5, (SELECT creator_user_id FROM library_assets WHERE id = $5), 'user-created', 'sfw', '{}', 'mist', $6::jsonb)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, summary = EXCLUDED.summary, document = EXCLUDED.document, updated_at = now()
             RETURNING id`,
            [randomUUID(), 'place', loc.name, loc.description ?? '', worldId, JSON.stringify(placeDocument)],
          );
          placeId = created.rows[0].id;
          console.log(`World ${worldId}: location "${loc.name}" (${loc.id}) created new place asset ${placeId}`);
          migrated++;
        } else {
          await client.query(
            `UPDATE library_assets SET name = $1, summary = $2, document = $3::jsonb, updated_at = now()
             WHERE id = $4`,
            [loc.name, loc.description ?? '', JSON.stringify(placeDocument), placeId],
          );
        }

        if (loc.libraryAssetId !== placeId) {
          await client.query(
            `UPDATE library_assets SET document = jsonb_set(document, '{locations}', (
              SELECT jsonb_agg(
                CASE WHEN item->>'id' = $2 THEN jsonb_set(item, '{libraryAssetId}', to_jsonb($3::text)) ELSE item END
              ) FROM jsonb_array_elements(document->'locations') AS item
            ) WHERE id = $1`,
            [worldId, loc.id, placeId],
          );
        }
      } catch (err) {
        const msg = `Location "${loc.name}" (${loc.id}): ${err instanceof Error ? err.message : String(err)}`;
        console.error(msg);
        errors.push(msg);
      }
    }

    console.log(`World ${worldId}: migrated ${migrated} locations, ${errors.length} errors`);
    return { migrated, errors };
  } finally {
    client.release();
  }
}

async function main() {
  console.log('Starting world location migration...');
  
  const worldsResult = await pool.query("SELECT id, name FROM library_assets WHERE type = 'world'");
  console.log(`Found ${worldsResult.rowCount} worlds`);

  let totalMigrated = 0;
  const allErrors = [];

  for (const world of worldsResult.rows) {
    console.log(`\nProcessing world: ${world.name} (${world.id})`);
    const result = await migrateWorld(world.id);
    totalMigrated += result.migrated;
    allErrors.push(...result.errors);
  }

  console.log(`\n=== Migration complete ===`);
  console.log(`Total locations migrated: ${totalMigrated}`);
  console.log(`Total errors: ${allErrors.length}`);
  
  if (allErrors.length > 0) {
    console.log('Errors:');
    allErrors.forEach(e => console.log(`  - ${e}`));
  }

  await pool.end();
  process.exit(allErrors.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});