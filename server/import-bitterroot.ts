import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BITTERROOT_OWNER_DISCORD_ID, buildBitterrootSeedAssets, type BitterrootSourceWorld, type BitterrootSeedAsset } from './bitterroot-import.js';
import { applyBrackenjawCanon } from './bitterroot-brackenjaw-canon.js';
import { applyBitterrootCoreLinks } from './bitterroot-core-links.js';
import { applyBitterrootLinkGraph, auditBitterrootLinks } from './bitterroot-link-graph.js';
import { applyRedLightDistrictCanon } from './bitterroot-red-light-district-canon.js';
import { applySlaveMarketCanon } from './bitterroot-slave-market-canon.js';
import { applyBitterrootTravelCanon } from './bitterroot-travel-canon.js';
import { applyWhisperingWoodsCanon } from './bitterroot-whispering-canon.js';
import { createPool } from './db.js';
import { rebuildWorldProjection, syncWorldEmbeddedEntities } from './world-entity-sync.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const source = applyBitterrootLinkGraph(
  applyBitterrootTravelCanon(
    applyBitterrootCoreLinks(
      applyBrackenjawCanon(
        applyRedLightDistrictCanon(
          applySlaveMarketCanon(
            applyWhisperingWoodsCanon(
              JSON.parse(await readFile(resolve(process.cwd(), 'server/data/bitterroot.json'), 'utf8')) as BitterrootSourceWorld,
            ),
          ),
        ),
      ),
    ),
  ),
);
const linkIssues = auditBitterrootLinks(source);
if (linkIssues.length) {
  throw new Error(`Bitterroot contains ${linkIssues.length} dangling canonical link(s): ${linkIssues.map((issue) => `${issue.owner}.${issue.field} -> ${issue.target}`).join(', ')}`);
}
const assets = buildBitterrootSeedAssets(source);
const pool = createPool(process.env.DATABASE_URL);
const client = await pool.connect();

async function insertAsset(asset: BitterrootSeedAsset, ownerUserId: string, originWorldId: string | null) {
  // Insert-only. This importer previously used DO UPDATE SET document =
  // EXCLUDED.document, which meant a re-run overwrote the world document and
  // destroyed every libraryAssetId/worldEntryId link an editor or a repair had
  // added — the opposite of what API_CONTRACT.md documents for this import. An
  // existing row is now left exactly as it is.
  const result = await client.query(
    `INSERT INTO library_assets (
       id, type, name, summary, origin_world_id, creator_user_id, source_type, source_asset_id,
       content_rating, tags, dependency_count, pinned, visual_tone, document, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'public-curated',$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
     ON CONFLICT (source_type, source_asset_id) WHERE source_asset_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [randomUUID(), asset.type, asset.name, asset.summary, originWorldId, ownerUserId, asset.sourceAssetId,
      asset.contentRating, asset.tags, asset.dependencyCount, asset.type === 'world', asset.visualTone, JSON.stringify(asset.document), asset.createdAt, asset.updatedAt],
  );
  if (result.rowCount) return { id: String(result.rows[0].id), inserted: true };

  const existing = await client.query(
    `SELECT id FROM library_assets
     WHERE source_type = 'public-curated' AND source_asset_id = $1`,
    [asset.sourceAssetId],
  );
  if (!existing.rowCount) throw new Error(`Could not resolve asset ${asset.sourceAssetId}.`);
  return { id: String(existing.rows[0].id), inserted: false };
}

try {
  await client.query('BEGIN');
  const owner = await client.query('SELECT id FROM users WHERE discord_id = $1', [BITTERROOT_OWNER_DISCORD_ID]);
  if (!owner.rowCount) throw new Error('Eirvargr must sign in to Orbis once before Bitterroot can be imported.');
  const ownerUserId = String(owner.rows[0].id);
  const world = assets.find((asset) => asset.type === 'world');
  if (!world) throw new Error('The Bitterroot source does not contain its world record.');
  const worldResult = await insertAsset(world, ownerUserId, null);
  let inserted = Number(worldResult.inserted);
  for (const asset of assets.filter((item) => item !== world)) {
    const result = await insertAsset(asset, ownerUserId, worldResult.id);
    inserted += Number(result.inserted);
  }

  // Establish the projection links. The seed writes the world document and its
  // children as two parallel copies, so without this step neither side carries the
  // other's ids and the two representations can drift apart on the next editor
  // save. Matching by name is expected here: the children were just created from
  // the same source, so this links them rather than creating duplicates.
  const stored = await client.query('SELECT document, content_rating FROM library_assets WHERE id = $1', [worldResult.id]);
  const worldDocument = stored.rows[0]?.document as Record<string, unknown> | undefined;
  if (worldDocument) {
    const sync = await syncWorldEmbeddedEntities(client, worldResult.id, ownerUserId, worldDocument, String(stored.rows[0].content_rating ?? 'sfw'), {
      allowLegacyNameMatch: true,
      strict: true,
    });
    await rebuildWorldProjection(client, worldResult.id, { dropUnlinked: false });
    if (sync.created || sync.updated || sync.linked) {
      console.log(`Bitterroot projection: ${sync.created} linked, ${sync.updated} refreshed, ${sync.linked} back-links written.`);
    }
  }

  await client.query('COMMIT');
  console.log(`Bitterroot synchronization complete: ${inserted} inserted, ${assets.length - inserted} already present and left untouched, ${assets.length} total.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
