#!/usr/bin/env node
/**
 * Repair the very specific duplicate shape created by the first world-entity
 * backfill: a generated user-created child with worldEntryId beside one unique
 * older curated/imported row with the same world/type/name.
 *
 * DRY RUN IS THE DEFAULT. Nothing is changed without --apply.
 * Ambiguous names, referenced generated rows, and post-migration edit history are
 * deliberately refused instead of guessed. A Speculus catalogue row on the generated
 * twin is expected: deleting the twin retires that accidental SPC identity via the
 * existing database trigger while the older canonical row keeps its own identity.
 *
 * Usage:
 *   DATABASE_URL=... npm run repair:world-duplicates
 *   DATABASE_URL=... npm run repair:world-duplicates -- --apply
 */

import { createPool } from './dist-server/db.js';
import { worldCollectionKeyForType } from './dist-server/world-entity-sync.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required. Refusing to guess a database.');
  process.exit(2);
}

const apply = process.argv.includes('--apply');
const pool = createPool(databaseUrl);
const legacySources = ['legacy-import', 'public-curated', 'curated', 'imported-v2', 'copied'];

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function replaceWorldBackLink(document, collectionKey, worldEntryId, generatedId, canonicalId) {
  const items = Array.isArray(document[collectionKey]) ? document[collectionKey] : [];
  let matches = 0;
  const nextItems = items.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const entry = { ...raw };
    if (text(entry.libraryAssetId) === generatedId || text(entry.id) === worldEntryId) {
      matches += 1;
      entry.libraryAssetId = canonicalId;
    }
    return entry;
  });
  return { matches, document: { ...document, [collectionKey]: nextItems } };
}

async function main() {
  const generated = await pool.query(
    `SELECT g.id, g.type, g.name, g.summary, g.origin_world_id, g.creator_user_id,
            g.content_rating, g.document, w.name AS world_name, w.document AS world_document
     FROM library_assets g
     JOIN library_assets w ON w.id = g.origin_world_id AND w.type = 'world'
     WHERE g.source_type = 'user-created'
       AND g.type = ANY($1::text[])
       AND COALESCE(g.document->>'worldEntryId', '') <> ''
     ORDER BY w.name, g.type, g.name, g.id`,
    [['place', 'species', 'faction', 'society', 'family', 'memory']],
  );

  const plans = [];
  const refused = [];

  for (const row of generated.rows) {
    const generatedId = String(row.id);
    const worldId = String(row.origin_world_id);
    const worldEntryId = text(object(row.document).worldEntryId);
    const collectionKey = worldCollectionKeyForType(String(row.type));
    if (!collectionKey) continue;

    const candidates = await pool.query(
      `SELECT id, source_type, document
       FROM library_assets
       WHERE id <> $1
         AND origin_world_id = $2
         AND type = $3
         AND name = $4
         AND source_type = ANY($5::text[])
         AND (COALESCE(document->>'worldEntryId', '') = '' OR document->>'worldEntryId' = $6)
       ORDER BY id
       LIMIT 3`,
      [generatedId, worldId, row.type, row.name, legacySources, worldEntryId],
    );
    if (candidates.rowCount !== 1) {
      if ((candidates.rowCount ?? 0) > 1) {
        refused.push(`${row.world_name} / ${row.type} / ${row.name}: ${candidates.rowCount} legacy candidates; ambiguous.`);
      }
      continue;
    }

    const canonical = candidates.rows[0];
    const canonicalId = String(canonical.id);
    const backlink = replaceWorldBackLink(object(row.world_document), collectionKey, worldEntryId, generatedId, canonicalId);
    if (backlink.matches !== 1) {
      refused.push(`${row.world_name} / ${row.type} / ${row.name}: expected exactly one world back-link, found ${backlink.matches}.`);
      continue;
    }

    const [references, revisions, registry] = await Promise.all([
      pool.query(
        `SELECT id, type, name
         FROM library_assets
         WHERE id <> $1 AND id <> $2
           AND (source_asset_id = $3 OR document::text LIKE $4)
         LIMIT 3`,
        [generatedId, worldId, generatedId, `%${generatedId}%`],
      ),
      pool.query('SELECT count(*)::int AS count FROM library_asset_revisions WHERE asset_id = $1', [generatedId]),
      pool.query('SELECT count(*)::int AS count FROM speculus_catalog_registry WHERE asset_id = $1', [generatedId]),
    ]);
    const revisionCount = Number(revisions.rows[0]?.count ?? 0);
    const registryCount = Number(registry.rows[0]?.count ?? 0);
    if ((references.rowCount ?? 0) > 0 || revisionCount > 0) {
      refused.push(`${row.world_name} / ${row.type} / ${row.name}: generated row has ${references.rowCount ?? 0} external refs and ${revisionCount} revisions; refusing a potentially edited twin.`);
      continue;
    }

    plans.push({
      generatedId,
      canonicalId,
      worldId,
      worldName: String(row.world_name),
      type: String(row.type),
      name: String(row.name),
      summary: String(row.summary ?? ''),
      contentRating: String(row.content_rating ?? 'sfw'),
      generatedDocument: object(row.document),
      canonicalDocument: object(canonical.document),
      worldDocument: backlink.document,
      worldEntryId,
      sourceType: String(canonical.source_type),
      accidentalRegistryRows: registryCount,
    });
  }

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${plans.length} safe duplicate repair(s); ${refused.length} ambiguous/unsafe candidate(s).`);
  for (const plan of plans) {
    console.log(`REPAIR ${plan.worldName} / ${plan.type} / ${plan.name}: ${plan.generatedId} -> ${plan.canonicalId} (${plan.sourceType}); retire ${plan.accidentalRegistryRows} accidental SPC row(s)`);
  }
  for (const message of refused) console.log(`REFUSE ${message}`);

  if (!apply) {
    console.log('Dry run only. Re-run with --apply after reviewing this exact plan and a fresh database backup.');
    return;
  }

  for (const plan of plans) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT id, type, name, source_type, document
         FROM library_assets
         WHERE id = ANY($1::uuid[])
         ORDER BY id
         FOR UPDATE`,
        [[plan.worldId, plan.generatedId, plan.canonicalId]],
      );
      if (locked.rowCount !== 3) throw new Error('One of the planned rows changed/disappeared before apply.');

      const freshGenerated = locked.rows.find((entry) => String(entry.id) === plan.generatedId);
      const freshCanonical = locked.rows.find((entry) => String(entry.id) === plan.canonicalId);
      const freshWorld = locked.rows.find((entry) => String(entry.id) === plan.worldId);
      if (!freshGenerated || !freshCanonical || !freshWorld) throw new Error('Could not re-lock the full repair set.');
      if (String(freshGenerated.source_type) !== 'user-created') throw new Error('Generated row source changed; refusing stale repair plan.');
      if (!legacySources.includes(String(freshCanonical.source_type))) throw new Error('Canonical row source changed; refusing stale repair plan.');

      const freshEntryId = text(object(freshGenerated.document).worldEntryId);
      if (freshEntryId !== plan.worldEntryId) throw new Error('Generated worldEntryId changed; refusing stale repair plan.');
      const collectionKey = worldCollectionKeyForType(plan.type);
      if (!collectionKey) throw new Error(`Unsupported world child type ${plan.type}.`);
      const backlink = replaceWorldBackLink(object(freshWorld.document), collectionKey, plan.worldEntryId, plan.generatedId, plan.canonicalId);
      if (backlink.matches !== 1) throw new Error(`World back-link changed; found ${backlink.matches} matches.`);

      const mergedDocument = {
        ...object(freshCanonical.document),
        ...object(freshGenerated.document),
        worldEntryId: plan.worldEntryId,
      };

      // Point the world at the older canonical row first, then remove the generated
      // twin, then claim its worldEntryId on the canonical row. This ordering also
      // works after migration 019's unique worldEntryId index already exists.
      await client.query(
        'UPDATE library_assets SET document = $2::jsonb WHERE id = $1',
        [plan.worldId, JSON.stringify(backlink.document)],
      );
      await client.query('DELETE FROM library_assets WHERE id = $1', [plan.generatedId]);
      await client.query(
        `UPDATE library_assets
         SET summary = $2, content_rating = $3, document = $4::jsonb, updated_at = now()
         WHERE id = $1`,
        [plan.canonicalId, plan.summary, plan.contentRating, JSON.stringify(mergedDocument)],
      );
      await client.query(
        `UPDATE library_assets
         SET dependency_count = (SELECT count(*) FROM library_assets WHERE origin_world_id = $1)
         WHERE id = $1`,
        [plan.worldId],
      );
      await client.query('COMMIT');
      console.log(`APPLIED ${plan.worldName} / ${plan.type} / ${plan.name}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error(`FAILED ${plan.worldName} / ${plan.type} / ${plan.name}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    } finally {
      client.release();
    }
  }
}

try {
  await main();
} finally {
  await pool.end();
}
