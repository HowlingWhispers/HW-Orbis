import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BITTERROOT_OWNER_DISCORD_ID, buildBitterrootSeedAssets, type BitterrootSourceWorld, type BitterrootSeedAsset } from './bitterroot-import.js';
import { createPool } from './db.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const source = JSON.parse(await readFile(resolve(process.cwd(), 'server/data/bitterroot.json'), 'utf8')) as BitterrootSourceWorld;
const assets = buildBitterrootSeedAssets(source);
const pool = createPool(process.env.DATABASE_URL);
const client = await pool.connect();

async function insertAsset(asset: BitterrootSeedAsset, ownerUserId: string, originWorldId: string | null) {
  const result = await client.query(
    `INSERT INTO library_assets (
       id, type, name, summary, origin_world_id, creator_user_id, source_type, source_asset_id,
       content_rating, tags, dependency_count, pinned, visual_tone, document, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'public-curated',$7,'sfw',$8,$9,$10,$11,$12::jsonb,$13,$14)
     ON CONFLICT (source_type, source_asset_id) WHERE source_asset_id IS NOT NULL
     DO UPDATE SET
       origin_world_id = EXCLUDED.origin_world_id,
       creator_user_id = EXCLUDED.creator_user_id,
       name = EXCLUDED.name,
       summary = EXCLUDED.summary,
       content_rating = EXCLUDED.content_rating,
       tags = EXCLUDED.tags,
       dependency_count = EXCLUDED.dependency_count,
       pinned = EXCLUDED.pinned,
       visual_tone = EXCLUDED.visual_tone,
       document = EXCLUDED.document,
       updated_at = EXCLUDED.updated_at
     RETURNING id, (xmax = 0) AS inserted`,
    [randomUUID(), asset.type, asset.name, asset.summary, originWorldId, ownerUserId, asset.sourceAssetId,
      asset.tags, asset.dependencyCount, asset.type === 'world', asset.visualTone, JSON.stringify(asset.document), asset.createdAt, asset.updatedAt],
  );
  if (!result.rowCount) throw new Error(`Could not resolve asset ${asset.sourceAssetId}.`);
  return { id: String(result.rows[0].id), inserted: Boolean(result.rows[0].inserted) };
}

try {
  await client.query('BEGIN');
  const owner = await client.query('SELECT id FROM users WHERE discord_id = $1', [BITTERROOT_OWNER_DISCORD_ID]);
  if (!owner.rowCount) throw new Error('Eirvargr must sign in to Coda once before Bitterroot can be imported.');
  const ownerUserId = String(owner.rows[0].id);
  const world = assets.find((asset) => asset.type === 'world');
  if (!world) throw new Error('The Bitterroot source does not contain its world record.');
  const worldResult = await insertAsset(world, ownerUserId, null);
  let inserted = Number(worldResult.inserted);
  for (const asset of assets.filter((item) => item !== world)) {
    const result = await insertAsset(asset, ownerUserId, worldResult.id);
    inserted += Number(result.inserted);
  }
  await client.query('COMMIT');
  console.log(`Bitterroot synchronization complete: ${inserted} inserted, ${assets.length - inserted} refreshed, ${assets.length} total.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
