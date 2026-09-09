import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { WorldVisibility } from './world-access.js';

const entitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
}).passthrough();

const worldSchema = z.object({
  id: z.string().min(1),
  identity: z.object({
    name: z.string().min(1),
    description: z.string().default(''),
    genre: z.string().default(''),
    tone: z.string().default(''),
  }).passthrough(),
  rules: z.record(z.string(), z.unknown()).default({}),
  lore: z.record(z.string(), z.unknown()).default({}),
  species: z.array(entitySchema).default([]),
  locations: z.array(entitySchema).default([]),
  factions: z.array(entitySchema).default([]),
  families: z.array(entitySchema).default([]),
  memories: z.array(entitySchema).default([]),
  societies: z.array(entitySchema).default([]),
  timeWeather: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).passthrough();

const backupSchema = z.object({
  format: z.literal('hw-world-backup'),
  version: z.literal(1),
  exportedAt: z.string().min(1),
  world: worldSchema,
  runtimeSession: z.unknown().optional(),
}).passthrough();

export type WorldBackup = z.infer<typeof backupSchema>;
export type BackupAssetType = 'world' | 'place' | 'faction' | 'species' | 'society' | 'family' | 'memory';

export interface PreparedBackupAsset {
  sourceAssetId: string;
  type: BackupAssetType;
  name: string;
  summary: string;
  document: Record<string, unknown>;
  tags: string[];
  dependencyCount: number;
  visualTone: 'moon' | 'forest' | 'ember' | 'mist' | 'violet' | 'river';
  createdAt: string;
  updatedAt: string;
}

export interface PreparedWorldBackup {
  backup: WorldBackup;
  assets: PreparedBackupAsset[];
  sha256: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const displayName = (entity: Record<string, unknown>) =>
  typeof entity.name === 'string' && entity.name.trim()
    ? entity.name.trim()
    : typeof entity.title === 'string' && entity.title.trim()
      ? entity.title.trim()
      : 'Untitled';

const compactSummary = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= 300) return text;
  return `${text.slice(0, 297).trim()}...`;
};

const sourceIdentity = (type: BackupAssetType, id: string) => `hw-world-backup-v1:${type}:${id}`;

const dependencyCount = (entity: Record<string, unknown>) =>
  Object.values(entity).reduce<number>((total, value) => total + (Array.isArray(value) ? value.length : 0), 0);

function cloneEntity(entity: Record<string, unknown>) {
  return structuredClone(entity);
}

export function parseWorldBackup(raw: string): WorldBackup {
  return backupSchema.parse(JSON.parse(raw));
}

export function prepareWorldBackup(raw: string, visibility: WorldVisibility): PreparedWorldBackup {
  const backup = parseWorldBackup(raw);
  const world = backup.world;
  const worldDocument: Record<string, unknown> = {
    sourceId: world.id,
    identity: structuredClone(world.identity),
    rules: structuredClone(world.rules),
    lore: structuredClone(world.lore),
    species: structuredClone(world.species),
    locations: structuredClone(world.locations),
    factions: structuredClone(world.factions),
    societies: structuredClone(world.societies),
    families: structuredClone(world.families),
    memories: structuredClone(world.memories),
    timeWeather: structuredClone(world.timeWeather),
    worldSettings: {
      visibility,
      showInLibrary: visibility === 'public',
      allowForking: false,
    },
    importProvenance: {
      format: backup.format,
      version: backup.version,
      exportedAt: backup.exportedAt,
    },
  };

  const children = world.species.length + world.locations.length + world.factions.length
    + world.societies.length + world.families.length + world.memories.length;
  const assets: PreparedBackupAsset[] = [{
    sourceAssetId: sourceIdentity('world', world.id),
    type: 'world',
    name: world.identity.name,
    summary: compactSummary(world.identity.description),
    document: worldDocument,
    tags: [world.identity.genre, 'Imported world'].filter(Boolean),
    dependencyCount: children,
    visualTone: 'moon',
    createdAt: world.createdAt,
    updatedAt: world.updatedAt,
  }];

  const add = (
    type: Exclude<BackupAssetType, 'world'>,
    entities: Array<Record<string, unknown>>,
    visualTone: PreparedBackupAsset['visualTone'],
    tag: string,
  ) => {
    for (const entity of entities) {
      const id = typeof entity.id === 'string' ? entity.id : '';
      if (!id) throw new Error(`${type} record is missing its stable source id.`);
      assets.push({
        sourceAssetId: sourceIdentity(type, id),
        type,
        name: displayName(entity),
        summary: compactSummary(entity.description),
        document: cloneEntity(entity),
        tags: [tag],
        dependencyCount: dependencyCount(entity),
        visualTone,
        createdAt: world.createdAt,
        updatedAt: world.updatedAt,
      });
    }
  };

  add('species', world.species.map(asRecord), 'violet', 'Species');
  add('place', world.locations.map(asRecord), 'mist', 'Place');
  add('faction', world.factions.map(asRecord), 'ember', 'Faction');
  add('society', world.societies.map(asRecord), 'forest', 'Society');
  add('family', world.families.map(asRecord), 'ember', 'Family');
  add('memory', world.memories.map(asRecord), 'river', 'World memory');

  const sourceIds = assets.map((asset) => asset.sourceAssetId);
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error('Backup contains duplicate stable source IDs.');
  for (const asset of assets) {
    if (JSON.stringify(asset.document).length > 128_000) {
      throw new Error(`${asset.type} ${asset.name} exceeds Orbis's current record document limit.`);
    }
  }

  return {
    backup,
    assets,
    sha256: createHash('sha256').update(raw).digest('hex'),
  };
}
