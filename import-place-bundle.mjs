#!/usr/bin/env node
/**
 * Import script for howling_whispers_private_place_bundle format
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool } from './dist-server/db.js';
import pg from 'pg';
const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error('Usage: node import-place-bundle.mjs <path-to-bundle.json>');
  process.exit(1);
}

const raw = await readFile(resolve(bundlePath), 'utf8');
const bundle = JSON.parse(raw);

if (bundle.format !== 'howling_whispers_private_place_bundle') {
  throw new Error(`Expected format "howling_whispers_private_place_bundle", got "${bundle.format}"`);
}

const place = bundle.place;
const ownerBinding = bundle.import.owner_binding;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

async function insertAsset(type, name, summary, originWorldId, ownerUserId, sourceAssetId, contentRating, tags, document, visualTone = 'moon') {
  const result = await client.query(
    `INSERT INTO library_assets (
       id, type, name, summary, origin_world_id, creator_user_id, source_type, source_asset_id,
       content_rating, tags, dependency_count, pinned, visual_tone, document, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'user-created',$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
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
    [randomUUID(), type, name, summary, originWorldId, ownerUserId, sourceAssetId,
      contentRating, tags, 0, type === 'world', visualTone, JSON.stringify(document), new Date().toISOString(), new Date().toISOString()],
  );
  if (!result.rowCount) throw new Error(`Could not resolve asset ${sourceAssetId}.`);
  return { id: String(result.rows[0].id), inserted: Boolean(result.rows[0].inserted) };
}

try {
  await client.query('BEGIN');

  // Find or create owner user
  const owner = await client.query('SELECT id FROM users WHERE discord_id = $1', [ownerBinding.discord_user_id]);
  if (!owner.rowCount) throw new Error(`Discord user ${ownerBinding.discord_user_id} must sign in to Orbis once before this world can be imported.`);
  const ownerUserId = String(owner.rows[0].id);

  // Create world asset
  const worldSourceId = `hw-place-bundle:${place.name}`;
  const worldDoc = {
    sourceId: worldSourceId,
    identity: {
      name: place.name,
      description: place.description,
      genre: 'fantasy',
      tone: 'tribal, communal, sex-positive',
    },
    rules: {},
    lore: { history: place.setting?.environment ?? '', cultures: '' },
    species: [],
    locations: [],
    factions: [],
    societies: [],
    families: [],
    memories: [],
    timeWeather: {},
    worldSettings: {
      visibility: bundle.import.visibility,
      showInLibrary: false,
      allowForking: false,
    },
    importProvenance: {
      format: bundle.format,
      version: bundle.version,
      importedAt: new Date().toISOString(),
    },
  };

  const worldResult = await insertAsset(
    'world',
    place.name,
    place.description.slice(0, 300),
    null,
    ownerUserId,
    worldSourceId,
    bundle.import.visibility === 'private' ? 'sfw' : 'adult',
    [place.setting?.environment ?? ''],
    worldDoc,
    'mist',
  );

  const worldId = worldResult.id;
  console.log(`World created: ${worldId}`);

  // Create species assets
  const speciesList = Object.entries(place.species ?? {});
  for (const [speciesKey, speciesData] of speciesList) {
    const speciesDoc = {
      displayName: speciesData.display_name,
      inspiration: speciesData.inspiration,
      sapient: speciesData.sapient,
      commonForms: speciesData.common_forms,
      expectedLifespanYears: speciesData.expected_lifespan_years,
      development: speciesData.development,
      typicalTraits: speciesData.typical_traits,
      notes: speciesData.notes,
    };
    await insertAsset(
      'species',
      speciesData.display_name,
      `${speciesData.inspiration} (lifespan: ${speciesData.expected_lifespan_years?.join?.('-') ?? '?'} years)`,
      worldId,
      ownerUserId,
      `hw-place-bundle:${place.name}:species:${speciesKey}`,
      'sfw',
      ['species', 'canine-kin'],
      speciesDoc,
      'violet',
    );
    console.log(`Species created: ${speciesData.display_name}`);
  }

  // Create place assets for core_locations
  const coreLocations = place.setting?.core_locations ?? [];
  for (const locName of coreLocations) {
    const locDoc = {
      kind: 'settlement',
      parentLocationId: null,
      description: `Core location in ${place.name}: ${locName}`,
    };
    await insertAsset(
      'place',
      locName,
      `Core location in ${place.name}`,
      worldId,
      ownerUserId,
      `hw-place-bundle:${place.name}:place:${locName.toLowerCase().replace(/\s+/g, '-')}`,
      'sfw',
      ['core-location'],
      locDoc,
      'mist',
    );
    console.log(`Place created: ${locName}`);
  }

  // Create society asset for the tribal community
  if (place.society) {
    const societyDoc = {
      name: place.name,
      type: 'tribal_community',
      description: place.society.structure ?? '',
      lifestyle: 'settled',
      kinshipBasis: place.society.structure ?? '',
      membershipRules: place.society.principles?.join('\n') ?? '',
      territoryNotes: `Population target: ${place.population?.target ?? '?'}`,
      seasonMovement: '',
      speciesIds: speciesList.map(([k]) => k),
      familyIds: [],
      factionIds: [],
      settlementLocationIds: coreLocations.map(l => l.toLowerCase().replace(/\s+/g, '-')),
      currentStatus: 'active',
      canonStatus: 'canon',
    };
    await insertAsset(
      'society',
      place.name,
      `Tribal community: ${place.society.structure ?? ''}`,
      worldId,
      ownerUserId,
      `hw-place-bundle:${place.name}:society:main`,
      'sfw',
      ['society', 'tribal'],
      societyDoc,
      'forest',
    );
    console.log(`Society created: ${place.name}`);
  }

  await client.query('COMMIT');
  console.log(`Import complete. World ID: ${worldId}`);

} catch (error) {
  await client.query('ROLLBACK');
  console.error('Import failed:', error);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}