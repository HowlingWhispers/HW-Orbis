import { createHash } from 'node:crypto';
import { z } from 'zod';

const entitySchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
}).passthrough();

const worldSchema = z.object({
  id: z.string().min(1),
  identity: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }).passthrough(),
  species: z.array(entitySchema).default([]),
  locations: z.array(entitySchema).default([]),
  factions: z.array(entitySchema).default([]),
  families: z.array(entitySchema).default([]),
  memories: z.array(entitySchema).default([]),
  societies: z.array(entitySchema).default([]),
}).passthrough();

const backupSchema = z.object({
  format: z.literal('hw-world-backup'),
  version: z.number().int().positive(),
  exportedAt: z.string().optional(),
  world: worldSchema,
  runtimeSession: z.unknown().nullable().optional(),
}).passthrough();

export type RebrandWorldBackup = z.infer<typeof backupSchema>;
export type ImportedAssetType = 'world' | 'place' | 'species' | 'faction' | 'society' | 'family' | 'memory';

export interface PlannedImportedAsset {
  id: string;
  type: ImportedAssetType;
  name: string;
  summary: string;
  originWorldId: string | null;
  sourceExternalId: string;
  document: Record<string, unknown>;
}

export interface RebrandWorldImportPlan {
  sourceWorldId: string;
  worldId: string;
  worldName: string;
  exportedAt?: string;
  runtimeSessionPresent: boolean;
  assets: PlannedImportedAsset[];
  counts: Record<ImportedAssetType, number>;
}

export function parseRebrandWorldBackup(value: unknown): RebrandWorldBackup {
  return backupSchema.parse(value);
}

export function stableImportUuid(sourceKey: string): string {
  const bytes = Buffer.from(createHash('sha256').update(`orbis:rebrand:${sourceKey}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function entityName(entity: Record<string, unknown>) {
  const name = typeof entity.name === 'string' ? entity.name : typeof entity.title === 'string' ? entity.title : '';
  return name.trim() || 'Untitled';
}

function entitySummary(entity: Record<string, unknown>) {
  return typeof entity.description === 'string' ? entity.description.trim().slice(0, 2000) : '';
}

export function buildRebrandWorldImportPlan(backup: RebrandWorldBackup): RebrandWorldImportPlan {
  const world = backup.world;
  const worldId = stableImportUuid(`world:${world.id}`);
  const worldDocument = structuredClone(world) as Record<string, unknown>;
  worldDocument._orbisImport = {
    source: 'rebrand-rescue',
    sourceWorldId: world.id,
    sourceFormat: backup.format,
    sourceVersion: backup.version,
    exportedAt: backup.exportedAt ?? null,
    runtimeSessionPresent: backup.runtimeSession != null,
  };
  if (backup.runtimeSession != null) worldDocument._rebrandRuntimeSession = structuredClone(backup.runtimeSession) as never;

  const assets: PlannedImportedAsset[] = [{
    id: worldId,
    type: 'world',
    name: world.identity.name.trim(),
    summary: (world.identity.description ?? '').trim().slice(0, 2000),
    originWorldId: null,
    sourceExternalId: world.id,
    document: worldDocument,
  }];

  const addEntities = (type: Exclude<ImportedAssetType, 'world'>, entities: Array<Record<string, unknown>>) => {
    for (const entity of entities) {
      const sourceId = String(entity.id);
      assets.push({
        id: stableImportUuid(`${type}:${sourceId}`),
        type,
        name: entityName(entity),
        summary: entitySummary(entity),
        originWorldId: worldId,
        sourceExternalId: sourceId,
        document: structuredClone(entity),
      });
    }
  };

  addEntities('place', world.locations);
  addEntities('species', world.species);
  addEntities('faction', world.factions);
  addEntities('society', world.societies);
  addEntities('family', world.families);
  addEntities('memory', world.memories);

  const counts = {
    world: 0,
    place: 0,
    species: 0,
    faction: 0,
    society: 0,
    family: 0,
    memory: 0,
  } satisfies Record<ImportedAssetType, number>;
  for (const asset of assets) counts[asset.type] += 1;

  return {
    sourceWorldId: world.id,
    worldId,
    worldName: world.identity.name.trim(),
    exportedAt: backup.exportedAt,
    runtimeSessionPresent: backup.runtimeSession != null,
    assets,
    counts,
  };
}
