import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool } from './db.js';
import { prepareWorldBackup, type PreparedBackupAsset } from './world-backup-import.js';
import type { WorldVisibility } from './world-access.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const args = process.argv.slice(2);
const valueOf = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const file = valueOf('--file');
const ownerDiscordId = valueOf('--owner-discord-id');
const visibilityValue = valueOf('--visibility') ?? 'private';
const apply = args.includes('--apply');

if (!file) throw new Error('Pass --file /path/to/world.hw-world.json.');
if (!ownerDiscordId || !/^\d{17,20}$/.test(ownerDiscordId)) throw new Error('Pass a valid --owner-discord-id.');
if (!['public', 'unlisted', 'private'].includes(visibilityValue)) throw new Error('--visibility must be public, unlisted, or private.');
const visibility = visibilityValue as WorldVisibility;

const sourcePath = resolve(process.cwd(), file);
const raw = await readFile(sourcePath, 'utf8');
const prepared = prepareWorldBackup(raw, visibility);
const world = prepared.assets.find((asset) => asset.type === 'world');
if (!world) throw new Error('The backup does not contain a world root.');

const pool = createPool(process.env.DATABASE_URL);
const client = await pool.connect();

async function insertAsset(asset: PreparedBackupAsset, ownerUserId: string, originWorldId: string | null) {
  const result = await client.query(
    `INSERT INTO library_assets (
       id, type, name, summary, origin_world_id, creator_user_id, source_type, source_asset_id,
       content_rating, tags, dependency_count, pinned, visual_tone, document, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'legacy-import',$7,'sfw',$8,$9,false,$10,$11::jsonb,$12,$13)
     RETURNING id`,
    [randomUUID(), asset.type, asset.name, asset.summary, originWorldId, ownerUserId, asset.sourceAssetId,
      asset.tags, asset.dependencyCount, asset.visualTone, JSON.stringify(asset.document), asset.createdAt, asset.updatedAt],
  );
  if (!result.rowCount) throw new Error(`Could not insert ${asset.sourceAssetId}.`);
  return String(result.rows[0].id);
}

try {
  const owner = await client.query('SELECT id, display_name FROM users WHERE discord_id = $1', [ownerDiscordId]);
  if (!owner.rowCount) throw new Error(`Discord user ${ownerDiscordId} must sign in to Orbis once before this world can be imported.`);
  const ownerUserId = String(owner.rows[0].id);
  const sourceIds = prepared.assets.map((asset) => asset.sourceAssetId);
  const conflicts = await client.query(
    `SELECT id, type, name, source_asset_id FROM library_assets
     WHERE source_type = 'legacy-import' AND source_asset_id = ANY($1::text[])`,
    [sourceIds],
  );
  if (conflicts.rowCount) {
    const names = conflicts.rows.map((row) => `${row.type}:${row.name} (${row.source_asset_id})`).join(', ');
    throw new Error(`Import stopped because stable source IDs already exist: ${names}`);
  }

  console.log(`World backup: ${prepared.backup.world.identity.name}`);
  console.log(`Owner: ${owner.rows[0].display_name} / Discord ${ownerDiscordId}`);
  console.log(`Visibility: ${visibility}`);
  console.log(`Assets: ${prepared.assets.length} total`);
  console.log(`Source SHA-256: ${prepared.sha256}`);
  console.log(`Source file remains untouched at: ${sourcePath}`);

  if (!apply) {
    console.log('DRY RUN ONLY. No database writes were made. Re-run with --apply after reviewing this report.');
  } else {
    await client.query('BEGIN');
    const worldId = await insertAsset(world, ownerUserId, null);
    for (const asset of prepared.assets) {
      if (asset === world) continue;
      await insertAsset(asset, ownerUserId, worldId);
    }
    await client.query('COMMIT');
    console.log(`Import complete: ${prepared.assets.length} assets inserted into private Orbis ownership for Discord ${ownerDiscordId}.`);
  }
} catch (error) {
  if (apply) await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
