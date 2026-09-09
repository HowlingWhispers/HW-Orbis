import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { buildRebrandWorldImportPlan, parseRebrandWorldBackup } from './rebrand-world-import.js';

function usage() {
  console.error('Usage: node dist-server/import-rebrand-world.js <backup.json> <owner-discord-id> [--commit] [--content-rating=sfw|adult]');
  process.exit(2);
}

const [, , filePath, ownerDiscordId, ...flags] = process.argv;
if (!filePath || !ownerDiscordId || !/^\d{17,20}$/.test(ownerDiscordId)) usage();

const commit = flags.includes('--commit');
const ratingFlag = flags.find((flag) => flag.startsWith('--content-rating='));
const contentRating = ratingFlag?.split('=')[1] ?? 'sfw';
if (contentRating !== 'sfw' && contentRating !== 'adult') usage();

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

try {
  const raw = await readFile(filePath);
  const checksum = createHash('sha256').update(raw).digest('hex');
  const parsed = parseRebrandWorldBackup(JSON.parse(raw.toString('utf8')));
  const plan = buildRebrandWorldImportPlan(parsed);

  const owner = await pool.query('SELECT id, discord_id, display_name FROM users WHERE discord_id = $1', [ownerDiscordId]);
  if (!owner.rowCount) throw new Error(`No Orbis user exists for Discord ID ${ownerDiscordId}. The owner must sign in to Orbis at least once before import.`);
  const ownerUserId = owner.rows[0].id as string;

  const targetIds = plan.assets.map((asset) => asset.id);
  const conflicts = await pool.query('SELECT id, type, name FROM library_assets WHERE id = ANY($1::uuid[]) ORDER BY type, name', [targetIds]);
  if (conflicts.rowCount) {
    console.error('Import refused because deterministic target IDs already exist:');
    for (const row of conflicts.rows) console.error(`- ${row.type}: ${row.name} (${row.id})`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      mode: commit ? 'commit' : 'dry-run',
      checksumSha256: checksum,
      ownerDiscordId,
      ownerUserId,
      ownerDisplayName: owner.rows[0].display_name,
      world: plan.worldName,
      sourceWorldId: plan.sourceWorldId,
      targetWorldId: plan.worldId,
      visibility: 'private',
      contentRating,
      runtimeSessionPresent: plan.runtimeSessionPresent,
      counts: plan.counts,
      totalAssets: plan.assets.length,
    }, null, 2));

    if (!commit) {
      console.log('Dry run only. Re-run with --commit after reviewing this report.');
    } else {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const asset of plan.assets) {
          await client.query(
            `INSERT INTO library_assets
              (id, type, name, summary, origin_world_id, creator_user_id, source_type, content_rating, tags, dependency_count, pinned, visual_tone, visibility, document)
             VALUES
              ($1,$2,$3,$4,$5,$6,'legacy-import',$7,$8,$9,false,'moon','private',$10::jsonb)`,
            [
              asset.id,
              asset.type,
              asset.name,
              asset.summary,
              asset.originWorldId,
              ownerUserId,
              contentRating,
              ['Rebrand import', plan.worldName],
              asset.type === 'world' ? plan.assets.length - 1 : 0,
              JSON.stringify(asset.document),
            ],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const imported = await pool.query(
        `SELECT type, count(*)::int AS count
         FROM library_assets
         WHERE id = ANY($1::uuid[])
         GROUP BY type`,
        [targetIds],
      );
      const importedCount = imported.rows.reduce((sum, row) => sum + Number(row.count), 0);
      if (importedCount !== plan.assets.length) throw new Error(`Post-import verification failed: expected ${plan.assets.length} assets, found ${importedCount}.`);

      const archiveRoot = process.env.ORBIS_WORLD_IMPORT_ARCHIVE_DIR || '/var/lib/howlingwhispers/orbis/world-imports';
      await mkdir(archiveRoot, { recursive: true });
      const safeName = plan.worldName.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'world';
      const archiveName = `${safeName}-${checksum.slice(0, 12)}.hw-world.json`;
      const archivePath = path.join(archiveRoot, archiveName);
      await copyFile(filePath, archivePath);
      await writeFile(`${archivePath}.sha256`, `${checksum}  ${archiveName}\n`, 'utf8');

      console.log(`Imported ${plan.assets.length} private assets for ${owner.rows[0].display_name}.`);
      console.log(`Original rescue package archived unchanged at ${archivePath}`);
      console.log(`SHA-256: ${checksum}`);
    }
  }
} finally {
  await pool.end();
}
