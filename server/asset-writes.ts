import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatabasePool } from './db.js';

export const assetTypes = ['world', 'character', 'place', 'item', 'faction', 'species', 'society', 'family', 'memory'] as const;
export type AssetType = (typeof assetTypes)[number];
export const contentRatings = ['sfw', 'adult'] as const;
export const visualTones = ['moon', 'forest', 'ember', 'mist', 'violet', 'river'] as const;

export const documentSchema = z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 128_000, 'Record content is too large.');

export const locationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  kind: z.string().trim().max(60).optional(),
  description: z.string().trim().max(5000).optional(),
  parentLocationId: z.string().uuid().nullable().optional(),
  libraryAssetId: z.string().uuid().nullable().optional(),
}).passthrough();

export const createAssetSchema = z.object({
  type: z.enum(assetTypes),
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2000).default(''),
  originWorldId: z.string().uuid().nullable().optional(),
  contentRating: z.enum(contentRatings).default('sfw'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  visualTone: z.enum(visualTones).default('moon'),
  document: documentSchema.default({}),
});

export const updateAssetSchema = createAssetSchema.omit({ type: true }).partial().extend({ document: documentSchema.optional() });

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

/** Errors raised by the write layer carry the HTTP status the API should return. */
export class AssetWriteError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'AssetWriteError';
  }
}

export type AssetWriteSource = 'editor' | 'coda' | 'import' | 'system';

export type AssetWriteResult = {
  assetId: string;
  type: string;
  name: string;
  revision: number;
  operation: 'create' | 'update';
  changedFields: string[];
  contentRating: string;
  originWorldId: string | null;
  created: boolean;
  updatedAt: string;
};

export async function canAuthorIntoWorld(pool: DatabasePool, worldId: string, userId: string, isSuperAdmin: boolean) {
  const result = await pool.query('SELECT id, type, creator_user_id FROM library_assets WHERE id = $1', [worldId]);
  if (!result.rowCount || result.rows[0].type !== 'world') return false;
  return isSuperAdmin || result.rows[0].creator_user_id === userId;
}

/** Worlds always carry a normalized privacy block; a model or editor cannot widen it implicitly. */
export function normalizeWorldDocument(document: Record<string, unknown>) {
  const rawSettings = document.worldSettings;
  const settings = rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
    ? rawSettings as Record<string, unknown>
    : {};
  const visibility = settings.visibility === 'public' || settings.visibility === 'unlisted' || settings.visibility === 'private'
    ? settings.visibility
    : 'private';
  return {
    ...document,
    worldSettings: {
      ...settings,
      visibility,
      showInLibrary: visibility === 'public' ? settings.showInLibrary === true : false,
      allowForking: settings.allowForking === true,
    },
  };
}

export async function syncWorldLocations(
  pool: DatabasePool,
  worldId: string,
  userId: string,
  document: Record<string, unknown>,
) {
  const rawLocations = document.locations;
  if (!Array.isArray(rawLocations)) return;

  const locations = rawLocations
    .map((loc, idx) => {
      const parsed = locationSchema.safeParse(loc);
      if (!parsed.success) {
        console.warn(`World ${worldId}: location at index ${idx} failed validation`, parsed.error.flatten());
        return null;
      }
      return parsed.data;
    })
    .filter((loc): loc is z.infer<typeof locationSchema> => loc !== null);

  const seenPlaceIds = new Set<string>();
  const errors: string[] = [];

  for (const loc of locations) {
    let placeId = loc.libraryAssetId;
    const placeDocument = {
      kind: loc.kind ?? 'region',
      parentLocationId: loc.parentLocationId ?? null,
      description: loc.description ?? '',
    };

    try {
      if (placeId) {
        const existing = await pool.query('SELECT id FROM library_assets WHERE id = $1 AND type = $2 AND origin_world_id = $3', [placeId, 'place', worldId]);
        if (!existing.rowCount) {
          errors.push(`Location "${loc.name}" (${loc.id}) references missing place asset ${placeId}; creating new`);
          placeId = null;
        }
      }

      if (!placeId) {
        const created = await pool.query(
          `INSERT INTO library_assets (id, type, name, summary, origin_world_id, creator_user_id, source_type, content_rating, tags, visual_tone, document)
           VALUES ($1, $2, $3, $4, $5, $6, 'user-created', 'sfw', '{}', 'mist', $7::jsonb)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, summary = EXCLUDED.summary, document = EXCLUDED.document, updated_at = now()
           RETURNING id`,
          [randomUUID(), 'place', loc.name, loc.description ?? '', worldId, userId, JSON.stringify(placeDocument)],
        );
        placeId = created.rows[0].id;
        if (loc.libraryAssetId !== placeId) {
          errors.push(`Location "${loc.name}" (${loc.id}) assigned new place asset ${placeId}`);
        }
      } else {
        await pool.query(
          `UPDATE library_assets SET name = $1, summary = $2, document = $3::jsonb, updated_at = now()
           WHERE id = $4`,
          [loc.name, loc.description ?? '', JSON.stringify(placeDocument), placeId],
        );
      }

      if (loc.libraryAssetId !== placeId) {
        await pool.query(
          `UPDATE library_assets SET document = jsonb_set(document, '{locations}', (
            SELECT jsonb_agg(
              CASE WHEN item->>'id' = $2 THEN jsonb_set(item, '{libraryAssetId}', to_jsonb($3::text)) ELSE item END
            ) FROM jsonb_array_elements(document->'locations') AS item
          ) WHERE id = $1`,
          [worldId, loc.id, placeId],
        );
      }

      seenPlaceIds.add(placeId!);
    } catch (err) {
      errors.push(`Location "${loc.name}" (${loc.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const existingPlaces = await pool.query('SELECT id FROM library_assets WHERE origin_world_id = $1 AND type = $2', [worldId, 'place']);
  for (const row of existingPlaces.rows) {
    if (!seenPlaceIds.has(row.id)) {
      console.warn(`World ${worldId}: place asset ${row.id} exists but no embedded location references it; retaining (not auto-deleted)`);
    }
  }

  await pool.query(
    `UPDATE library_assets SET dependency_count = (SELECT count(*) FROM library_assets WHERE origin_world_id = $1) WHERE id = $1`,
    [worldId],
  );

  if (errors.length) {
    console.warn(`World ${worldId} location sync warnings:`, errors);
  }
}

export async function currentAssetRevision(pool: DatabasePool, assetId: string) {
  const result = await pool.query('SELECT max(revision) AS revision FROM library_asset_revisions WHERE asset_id = $1', [assetId]);
  return Number(result.rows[0]?.revision ?? 0);
}

export async function recordAssetRevision(
  pool: DatabasePool,
  input: {
    assetId: string;
    operation: 'create' | 'update' | 'delete' | 'location-sync';
    source: AssetWriteSource;
    changedFields?: string[];
    documentBefore?: unknown;
    documentAfter?: unknown;
    performedBy?: string | null;
  },
) {
  const revision = await currentAssetRevision(pool, input.assetId) + 1;
  await pool.query(
    `INSERT INTO library_asset_revisions (asset_id, revision, operation, source, changed_fields, document_before, document_after, performed_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)
     ON CONFLICT (asset_id, revision) DO NOTHING`,
    [
      input.assetId, revision, input.operation, input.source, JSON.stringify(input.changedFields ?? []),
      input.documentBefore === undefined ? null : JSON.stringify(input.documentBefore),
      input.documentAfter === undefined ? null : JSON.stringify(input.documentAfter),
      input.performedBy ?? null,
    ],
  );
  return revision;
}

type WriteIdentity = { userId: string; isSuperAdmin: boolean };

/** The single create path. Editor saves and Coda operations both land here. */
export async function insertAsset(
  pool: DatabasePool,
  identity: WriteIdentity,
  rawInput: unknown,
  source: AssetWriteSource = 'editor',
): Promise<{ row: Record<string, unknown>; result: AssetWriteResult }> {
  const parsed = createAssetSchema.safeParse(rawInput);
  if (!parsed.success) throw new AssetWriteError(400, 'Those record details are not valid Orbis fields.', parsed.error.flatten());
  const asset = parsed.data;

  if (asset.type === 'world' && asset.originWorldId) {
    throw new AssetWriteError(400, 'A world cannot be created inside another world.');
  }
  if (asset.originWorldId && !await canAuthorIntoWorld(pool, asset.originWorldId, identity.userId, identity.isSuperAdmin)) {
    throw new AssetWriteError(403, 'Only the world owner can add records to this world.');
  }

  const document = asset.type === 'world' ? normalizeWorldDocument(asset.document) : asset.document;
  const id = randomUUID();
  const inserted = await pool.query(
    `INSERT INTO library_assets (id,type,name,summary,origin_world_id,creator_user_id,source_type,content_rating,tags,visual_tone,document)
     VALUES ($1,$2,$3,$4,$5,$6,'user-created',$7,$8,$9,$10::jsonb) RETURNING *`,
    [id, asset.type, asset.name, asset.summary, asset.originWorldId ?? null, identity.userId, asset.contentRating, asset.tags, asset.visualTone, JSON.stringify(document)],
  );
  const row = inserted.rows[0];
  const revision = await recordAssetRevision(pool, {
    assetId: row.id, operation: 'create', source, changedFields: ['name', 'summary', 'contentRating', 'tags', 'visualTone', 'document'],
    documentAfter: document, performedBy: identity.userId,
  });

  if (asset.type === 'world') await syncWorldLocations(pool, row.id, identity.userId, document);

  return {
    row,
    result: {
      assetId: String(row.id), type: String(row.type), name: String(row.name), revision, operation: 'create',
      changedFields: ['name', 'summary', 'contentRating', 'tags', 'visualTone', 'document'],
      contentRating: String(row.content_rating), originWorldId: row.origin_world_id ?? null, created: true,
      updatedAt: new Date(row.updated_at ?? Date.now()).toISOString(),
    },
  };
}

/** The single update path. Editor saves and Coda operations both land here. */
export async function applyAssetUpdate(
  pool: DatabasePool,
  identity: WriteIdentity,
  assetId: string,
  rawInput: unknown,
  source: AssetWriteSource = 'editor',
): Promise<{ row: Record<string, unknown>; result: AssetWriteResult }> {
  const parsed = updateAssetSchema.safeParse(rawInput);
  if (!parsed.success) throw new AssetWriteError(400, 'Those record details are not valid Orbis fields.', parsed.error.flatten());
  const asset = parsed.data;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) {
    throw new AssetWriteError(400, 'Use an exact Orbis record ID.');
  }

  const current = await pool.query('SELECT * FROM library_assets WHERE id = $1', [assetId]);
  if (!current.rowCount) throw new AssetWriteError(404, 'Record not found.');
  const existing = current.rows[0];
  if (existing.creator_user_id !== identity.userId && !identity.isSuperAdmin) {
    throw new AssetWriteError(403, 'Only the creator can change this record.');
  }
  if (asset.originWorldId !== undefined && asset.originWorldId !== existing.origin_world_id) {
    if (existing.type === 'world' && asset.originWorldId) {
      throw new AssetWriteError(400, 'A world cannot be moved inside another world.');
    }
    if (asset.originWorldId && !await canAuthorIntoWorld(pool, asset.originWorldId, identity.userId, identity.isSuperAdmin)) {
      throw new AssetWriteError(403, 'Only the world owner can move records into this world.');
    }
  }

  const nextDocument = asset.document ?? (existing.document ?? {}) as Record<string, unknown>;
  const nextAsset = {
    ...existing,
    name: asset.name ?? existing.name,
    summary: asset.summary ?? existing.summary,
    origin_world_id: asset.originWorldId === undefined ? existing.origin_world_id : asset.originWorldId,
    content_rating: asset.contentRating ?? existing.content_rating,
    tags: asset.tags ?? existing.tags,
    visual_tone: asset.visualTone ?? existing.visual_tone,
    document: nextDocument,
  };
  if (Object.prototype.hasOwnProperty.call(nextAsset.document, 'name')) nextAsset.document.name = nextAsset.name;
  if (Object.prototype.hasOwnProperty.call(nextAsset.document, 'title')) nextAsset.document.title = nextAsset.name;
  const identityBlock = nextAsset.document.identity;
  if (identityBlock && typeof identityBlock === 'object' && 'name' in (identityBlock as Record<string, unknown>)) (identityBlock as Record<string, unknown>).name = nextAsset.name;
  if (nextAsset.type === 'world') nextAsset.document = normalizeWorldDocument(nextAsset.document);

  const changedFields = ['name', 'summary', 'originWorldId', 'contentRating', 'tags', 'visualTone', 'document']
    .filter((field) => JSON.stringify(asset[field as keyof typeof asset] ?? null) !== JSON.stringify(
      field === 'document' ? (existing.document ?? {}) : field === 'name' ? existing.name
        : field === 'summary' ? existing.summary : field === 'originWorldId' ? existing.origin_world_id
          : field === 'contentRating' ? existing.content_rating : field === 'tags' ? existing.tags : existing.visual_tone,
    ));

  if (!changedFields.length) {
    const revision = await currentAssetRevision(pool, assetId);
    return {
      row: existing,
      result: {
        assetId, type: String(existing.type), name: String(existing.name), revision, operation: 'update', changedFields: [],
        contentRating: String(existing.content_rating), originWorldId: existing.origin_world_id ?? null, created: false,
        updatedAt: new Date(existing.updated_at ?? Date.now()).toISOString(),
      },
    };
  }

  const result = await pool.query(
    `UPDATE library_assets SET name=$2, summary=$3, origin_world_id=$4, content_rating=$5, tags=$6, visual_tone=$7, document=$8::jsonb, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [assetId, nextAsset.name, nextAsset.summary, nextAsset.origin_world_id, nextAsset.content_rating, nextAsset.tags, nextAsset.visual_tone, JSON.stringify(nextAsset.document)],
  );
  const row = result.rows[0];
  const revision = await recordAssetRevision(pool, {
    assetId, operation: 'update', source, changedFields,
    documentBefore: existing.document ?? {}, documentAfter: nextAsset.document, performedBy: identity.userId,
  });

  if (row.type === 'world') await syncWorldLocations(pool, assetId, identity.userId, row.document ?? {});

  return {
    row,
    result: {
      assetId, type: String(row.type), name: String(row.name), revision, operation: 'update', changedFields,
      contentRating: String(row.content_rating), originWorldId: row.origin_world_id ?? null, created: false,
      updatedAt: new Date(row.updated_at ?? Date.now()).toISOString(),
    },
  };
}
