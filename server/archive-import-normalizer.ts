import { createHash } from 'node:crypto';
import { z } from 'zod';

const assetTypes = ['world', 'character', 'place', 'item', 'faction', 'species', 'society', 'family', 'memory'] as const;
const sourceTypes = ['curated', 'user-created', 'imported-v2', 'copied', 'public-curated', 'legacy-import'] as const;
const tones = ['moon', 'forest', 'ember', 'mist', 'violet', 'river'] as const;
const statuses = ['active', 'archived', 'retired', 'sealed'] as const;

const toneSet = new Set<string>(tones);
const defaultToneByType: Record<(typeof assetTypes)[number], (typeof tones)[number]> = {
  world: 'moon',
  character: 'violet',
  place: 'mist',
  item: 'moon',
  faction: 'ember',
  species: 'forest',
  society: 'river',
  family: 'violet',
  memory: 'moon',
};

const documentSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 128_000,
  'A record document exceeds Orbis’s 128 KB limit.',
);

const registrySchema = z.object({
  prefix: z.string().regex(/^[A-Z]$/),
  ordinal: z.number().int().safe().positive(),
  generation: z.number().int().positive(),
  series: z.string().regex(/^[A-Z]{2}$/),
  number: z.number().int().min(1).max(99999),
  plate: z.string().regex(/^[A-Z]{2}[0-9]{5}$/),
  code: z.string().min(1).max(80),
  classification: z.string().min(1).max(120),
  status: z.enum(statuses),
  assignedAt: z.string().datetime(),
  retiredAt: z.string().datetime().nullable(),
  registryNumber: z.number().int().safe().positive(),
  assetCreatedAt: z.string().datetime(),
});

const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('record'), rootAssetId: z.string().uuid() }),
  z.object({ kind: z.literal('world'), rootAssetId: z.string().uuid() }),
  z.object({ kind: z.literal('account') }),
]);

const importRecordSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(assetTypes),
  name: z.string().trim().min(1).max(120),
  summary: z.string().default(''),
  originWorldId: z.string().uuid().nullable(),
  sourceType: z.enum(sourceTypes),
  sourceAssetId: z.string().max(500).nullable(),
  contentRating: z.enum(['sfw', 'adult']),
  tags: z.array(z.string().min(1).max(40)).max(20),
  dependencyCount: z.number().int().safe().min(0),
  pinned: z.boolean(),
  visualTone: z.string().optional().default(''),
  document: documentSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  speculus: z.unknown().optional().nullable(),
});

const importArchiveSchema = z.object({
  format: z.literal('orbis-transfer'),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  scope: scopeSchema,
  records: z.array(importRecordSchema).min(1).max(10_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ImportTransferRegistry = z.infer<typeof registrySchema>;
export type ImportTransferRecord = Omit<z.infer<typeof importRecordSchema>, 'visualTone' | 'speculus'> & {
  visualTone: (typeof tones)[number];
  speculus: ImportTransferRegistry | null;
};
export type ImportTransferArchive = Omit<z.infer<typeof importArchiveSchema>, 'records'> & {
  records: ImportTransferRecord[];
};
export type ArchiveImportRepairs = {
  defaultedVisualTones: number;
  truncatedSummaries: number;
  regeneratedSpeculus: number;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function zodMessage(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return 'The archive does not match the Orbis transfer format.';
  const path = issue.path.length ? ` at ${issue.path.join('.')}` : '';
  return `Invalid Orbis archive${path}: ${issue.message}`;
}

/**
 * Transfer v1 existed before every record had a complete SPC registry identity and
 * before visualTone/summary limits were enforced consistently. The checksum still
 * proves those old files are intact, so imports normalize only compatibility
 * metadata while preserving IDs, links, documents and timestamps.
 */
export function parseTransferArchiveForImport(raw: string): { archive: ImportTransferArchive; repairs: ArchiveImportRepairs } {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new Error(error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON.');
  }
  if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    throw new Error('Invalid Orbis archive: the JSON root must be an object.');
  }

  const rawObject = parsedJson as Record<string, unknown>;
  const suppliedChecksum = typeof rawObject.sha256 === 'string' ? rawObject.sha256 : '';
  if (!/^[a-f0-9]{64}$/.test(suppliedChecksum)) {
    throw new Error('Invalid Orbis archive: sha256 is missing or malformed.');
  }
  const { sha256: _checksum, ...rawBody } = rawObject;
  if (sha256(JSON.stringify(rawBody)) !== suppliedChecksum) {
    throw new Error('Archive checksum does not match. The file may be damaged or altered.');
  }

  let parsed: z.infer<typeof importArchiveSchema>;
  try {
    parsed = importArchiveSchema.parse(parsedJson);
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error(zodMessage(error));
    throw error;
  }

  const repairs: ArchiveImportRepairs = {
    defaultedVisualTones: 0,
    truncatedSummaries: 0,
    regeneratedSpeculus: 0,
  };

  const records: ImportTransferRecord[] = parsed.records.map((record) => {
    const registry = registrySchema.safeParse(record.speculus);
    const visualTone = toneSet.has(record.visualTone)
      ? record.visualTone as (typeof tones)[number]
      : defaultToneByType[record.type];
    if (visualTone !== record.visualTone) repairs.defaultedVisualTones += 1;

    const summary = record.summary.length > 2000 ? record.summary.slice(0, 2000) : record.summary;
    if (summary.length !== record.summary.length) repairs.truncatedSummaries += 1;
    if (!registry.success) repairs.regeneratedSpeculus += 1;

    return {
      ...record,
      summary,
      visualTone,
      speculus: registry.success ? registry.data : null,
    };
  });

  const ids = records.map((record) => record.id);
  if (new Set(ids).size !== ids.length) throw new Error('Archive contains duplicate record IDs.');

  const registryCodes = records.flatMap((record) => record.speculus ? [record.speculus.code] : []);
  if (new Set(registryCodes).size !== registryCodes.length) throw new Error('Archive contains duplicate SPC codes.');

  const recordsById = new Map(records.map((record) => [record.id, record]));
  for (const record of records) {
    const includedOrigin = record.originWorldId ? recordsById.get(record.originWorldId) : undefined;
    if (includedOrigin && includedOrigin.type !== 'world') {
      throw new Error(`${record.name} points to an origin record that is not a world.`);
    }
  }

  if (parsed.scope.kind === 'world') {
    const root = recordsById.get(parsed.scope.rootAssetId);
    if (!root || root.type !== 'world') throw new Error('World archive root record is missing or is not a world.');
  } else if (parsed.scope.kind === 'record' && !recordsById.has(parsed.scope.rootAssetId)) {
    throw new Error('Record archive root record is missing.');
  }

  return {
    archive: { ...parsed, records },
    repairs,
  };
}
