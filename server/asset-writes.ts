import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseClient, DatabaseExecutor, DatabasePool } from './db.js';
import {
  describeMalformedCollections,
  findMalformedCollections,
  isRecord,
  isWorldCollectionType,
  jsonSemanticallyEqual,
  mirrorCanonicalChildToWorld,
  rebuildWorldProjection,
  syncWorldEmbeddedEntities,
  WorldEntitySyncError,
  type WorldCollectionKey,
} from './world-entity-sync.js';
import { removeCanonicalChildrenMissingFromWorld, WorldChildRemovalError } from './world-child-removal.js';

export const assetTypes = ['world', 'persona', 'character', 'place', 'item', 'faction', 'species', 'society', 'family', 'memory'] as const;
export type AssetType = (typeof assetTypes)[number];
export const contentRatings = ['sfw', 'adult'] as const;
export const visualTones = ['moon', 'forest', 'ember', 'mist', 'violet', 'river'] as const;

export const documentSchema = z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 128_000, 'Record content is too large.');

// World-entry IDs are authoring identifiers, not database UUIDs. Bitterroot and
// imported worlds legitimately use stable slug IDs such as "bitterroot-continent".
export const locationSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  kind: z.string().trim().max(60).optional(),
  description: z.string().trim().max(5000).optional(),
  parentLocationId: z.string().trim().min(1).max(200).nullable().optional(),
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

type WriteIdentity = { userId: string; isSuperAdmin: boolean };

export type AssetWriteHooks = {
  beforeInsert?: (db: DatabaseExecutor, asset: CreateAssetInput) => Promise<CreateAssetInput>;
  beforeUpdate?: (db: DatabaseExecutor, existing: Record<string, unknown>, asset: UpdateAssetInput) => Promise<UpdateAssetInput>;
};

async function inTransaction<T>(pool: DatabasePool, work: (client: DatabaseExecutor) => Promise<T>) {
  // Production pg.Pool always exposes connect(). Tests intentionally use tiny
  // query-only executors; keep those unit tests useful without weakening the real
  // production transaction path.
  const maybePool = pool as unknown as { connect?: () => Promise<DatabaseClient> };
  if (typeof maybePool.connect !== 'function') return work(pool);

  const client = await maybePool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function canAuthorIntoWorld(db: DatabaseExecutor, worldId: string, userId: string, isSuperAdmin: boolean) {
  const result = await db.query('SELECT id, type, creator_user_id FROM library_assets WHERE id = $1', [worldId]);
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

/** Personas are reusable user assets, not world children. Sharing is explicit and private by default. */
export function normalizePersonaDocument(document: Record<string, unknown>, forcedSettings?: Record<string, unknown>) {
  const rawSettings = forcedSettings ?? (isRecord(document.personaSettings) ? document.personaSettings : {});
  const visibility = rawSettings.visibility === 'public' || rawSettings.visibility === 'unlisted'
    ? rawSettings.visibility
    : 'private';
  return {
    ...document,
    personaSettings: {
      visibility,
      showInLibrary: visibility === 'public' ? rawSettings.showInLibrary === true : false,
      allowUse: rawSettings.allowUse === true,
      allowForking: rawSettings.allowForking === true,
    },
  };
}

/**
 * Compatibility export used by the old one-off location migration. Runtime world
 * writes use the all-collection synchronizer below and never guess by name.
 */
export async function syncWorldLocations(
  db: DatabaseExecutor,
  worldId: string,
  userId: string,
  document: Record<string, unknown>,
  contentRating = 'sfw',
) {
  return syncWorldEmbeddedEntities(db, worldId, userId, document, contentRating, {
    allowLegacyNameMatch: true,
    onlyKeys: ['locations'],
  });
}

/**
 * Collections whose canonical rows are owned by the shared world-child service.
 *
 * The world root document keeps a compatibility projection of these, but the
 * root write path must never read it as canon. A root save carries whatever the
 * editor last loaded, which is routinely older than a canonical child edited
 * elsewhere, so submitting one must not update or delete a canonical row.
 */
const rootOwnedWorldCollections = ['locations'] as const;

async function syncWorldCollections(
  db: DatabaseExecutor,
  worldId: string,
  userId: string,
  document: Record<string, unknown>,
  contentRating: string,
  strict: boolean,
  options: { skipKeys?: readonly WorldCollectionKey[] } = {},
) {
  try {
    return await syncWorldEmbeddedEntities(db, worldId, userId, document, contentRating, {
      strict,
      allowLegacyNameMatch: false,
      skipKeys: options.skipKeys,
    });
  } catch (error) {
    if (error instanceof WorldEntitySyncError) {
      throw new AssetWriteError(409, 'Orbis refused an ambiguous world-entity write. No part of the change was saved.', error.issues);
    }
    throw error;
  }
}

/**
 * Restore the stored compatibility projections for root-owned collections.
 *
 * This is the boundary that makes a stale or hand-crafted `document.locations`
 * inert: the submitted array is discarded before change detection, inferred
 * removal, the world write and the projection rebuild, so it can neither
 * overwrite nor delete a canonical Place.
 */
function restoreRootOwnedCollections(
  existingDocument: Record<string, unknown>,
  nextDocument: Record<string, unknown>,
) {
  const restored = { ...nextDocument };
  for (const key of rootOwnedWorldCollections) {
    if (existingDocument[key] === undefined) delete restored[key];
    else restored[key] = existingDocument[key];
  }
  return restored;
}

export async function currentAssetRevision(db: DatabaseExecutor, assetId: string) {
  const result = await db.query('SELECT max(revision) AS revision FROM library_asset_revisions WHERE asset_id = $1', [assetId]);
  return Number(result.rows[0]?.revision ?? 0);
}

export async function recordAssetRevision(
  db: DatabaseExecutor,
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
  const revision = await currentAssetRevision(db, input.assetId) + 1;
  await db.query(
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

async function recordProjectionRevision(
  db: DatabaseExecutor,
  projection: Awaited<ReturnType<typeof mirrorCanonicalChildToWorld>>,
  performedBy: string,
) {
  if (!projection.changed || !projection.worldId) return;
  await recordAssetRevision(db, {
    assetId: projection.worldId,
    operation: 'location-sync',
    source: 'system',
    changedFields: ['document'],
    documentBefore: projection.before,
    documentAfter: projection.after,
    performedBy,
  });
  await db.query(
    `UPDATE library_assets
     SET dependency_count = (SELECT count(*) FROM library_assets WHERE origin_world_id = $1)
     WHERE id = $1`,
    [projection.worldId],
  );
}

function childDocumentWithStableEntryId(type: string, id: string, document: Record<string, unknown>) {
  if (!isWorldCollectionType(type)) return document;
  const worldEntryId = typeof document.worldEntryId === 'string' && document.worldEntryId.trim()
    ? document.worldEntryId.trim()
    : id;
  return { ...document, worldEntryId };
}

/**
 * Reject a world document whose collections are present but not lists.
 *
 * `documentSchema` accepts any JSON value, so a collection could reach
 * PostgreSQL as the string "[]". The world then read as having no such
 * children while every save was refused as ambiguous. Absent collections stay
 * legitimate — a world that has not authored any species is valid — so only a
 * present-but-unusable value is rejected. Nothing is coerced: guessing at the
 * author's intent is how the malformed value survived unnoticed in the first
 * place.
 */
export function assertWorldDocumentCollections(type: string, document: unknown) {
  if (type !== 'world') return;
  const problems = findMalformedCollections(document);
  if (!problems.length) return;
  throw new AssetWriteError(
    400,
    `That world has a collection that is not a list (${describeMalformedCollections(problems)}). `
    + 'Make it a list, or remove the field if the world has no such records. Orbis will not guess which you meant.',
    problems.map((problem) => ({ path: [problem.key], message: `expected an array, received ${problem.actual}` })),
  );
}

/** The single create path. Editor saves and Coda operations both land here. */
export async function insertAsset(
  pool: DatabasePool,
  identity: WriteIdentity,
  rawInput: unknown,
  source: AssetWriteSource = 'editor',
  hooks: AssetWriteHooks = {},
): Promise<{ row: Record<string, unknown>; result: AssetWriteResult }> {
  const parsed = createAssetSchema.safeParse(rawInput);
  if (!parsed.success) throw new AssetWriteError(400, 'Those record details are not valid Orbis fields.', parsed.error.flatten());
  let asset = parsed.data;

  if (asset.type === 'world' && asset.originWorldId) throw new AssetWriteError(400, 'A world cannot be created inside another world.');
  if (asset.type === 'persona' && asset.originWorldId) throw new AssetWriteError(400, 'A Persona is reusable and cannot be created inside a world.');

  return inTransaction(pool, async (client) => {
    if (asset.originWorldId) {
      // Every world/child transaction locks the world first. That gives edits a
      // stable lock order and prevents child/world deadlocks under concurrent saves.
      await client.query('SELECT id FROM library_assets WHERE id = $1 AND type = \'world\' FOR UPDATE', [asset.originWorldId]);
      if (!await canAuthorIntoWorld(client, asset.originWorldId, identity.userId, identity.isSuperAdmin)) {
        throw new AssetWriteError(403, 'Only the world owner can add records to this world.');
      }
    }

    if (hooks.beforeInsert) asset = await hooks.beforeInsert(client, asset);

    const id = randomUUID();
    const baseDocument = asset.type === 'world'
      ? normalizeWorldDocument(asset.document)
      : asset.type === 'persona'
        ? normalizePersonaDocument(asset.document, source === 'coda' ? {} : undefined)
        : asset.document;
    const document = asset.originWorldId
      ? childDocumentWithStableEntryId(asset.type, id, baseDocument)
      : baseDocument;
    assertWorldDocumentCollections(asset.type, document);
    const inserted = await client.query(
      `INSERT INTO library_assets (id,type,name,summary,origin_world_id,creator_user_id,source_type,content_rating,tags,visual_tone,document)
       VALUES ($1,$2,$3,$4,$5,$6,'user-created',$7,$8,$9,$10::jsonb) RETURNING *`,
      [id, asset.type, asset.name, asset.summary, asset.originWorldId ?? null, identity.userId, asset.contentRating, asset.tags, asset.visualTone, JSON.stringify(document)],
    );
    let row = inserted.rows[0] as Record<string, unknown>;
    const revision = await recordAssetRevision(client, {
      assetId: String(row.id), operation: 'create', source, changedFields: ['name', 'summary', 'contentRating', 'tags', 'visualTone', 'document'],
      documentAfter: document, performedBy: identity.userId,
    });

    if (asset.type === 'world') {
      await syncWorldCollections(client, String(row.id), identity.userId, document, String(row.content_rating ?? asset.contentRating), true);
      await rebuildWorldProjection(client, String(row.id), { dropUnlinked: true });
      const fresh = await client.query('SELECT * FROM library_assets WHERE id = $1', [row.id]);
      row = fresh.rows[0] as Record<string, unknown>;
    } else if (asset.originWorldId && isWorldCollectionType(asset.type)) {
      const projection = await mirrorCanonicalChildToWorld(client, row);
      await recordProjectionRevision(client, projection, identity.userId);
    }

    return {
      row,
      result: {
        assetId: String(row.id), type: String(row.type), name: String(row.name), revision, operation: 'create',
        changedFields: ['name', 'summary', 'contentRating', 'tags', 'visualTone', 'document'],
        contentRating: String(row.content_rating), originWorldId: row.origin_world_id ? String(row.origin_world_id) : null, created: true,
        updatedAt: new Date(String(row.updated_at ?? Date.now())).toISOString(),
      },
    };
  });
}

/** The single update path. Editor saves and Coda operations both land here. */
export async function applyAssetUpdate(
  pool: DatabasePool,
  identity: WriteIdentity,
  assetId: string,
  rawInput: unknown,
  source: AssetWriteSource = 'editor',
  hooks: AssetWriteHooks = {},
): Promise<{ row: Record<string, unknown>; result: AssetWriteResult }> {
  const parsed = updateAssetSchema.safeParse(rawInput);
  if (!parsed.success) throw new AssetWriteError(400, 'Those record details are not valid Orbis fields.', parsed.error.flatten());
  let asset = parsed.data;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) {
    throw new AssetWriteError(400, 'Use an exact Orbis record ID.');
  }

  return inTransaction(pool, async (client) => {
    const peek = await client.query('SELECT * FROM library_assets WHERE id = $1', [assetId]);
    if (!peek.rowCount || !peek.rows[0]) throw new AssetWriteError(404, 'Record not found.');
    const peekType = String(peek.rows[0].type);
    const peekOriginWorldId = peek.rows[0].origin_world_id ? String(peek.rows[0].origin_world_id) : '';

    if (peekOriginWorldId && isWorldCollectionType(peekType)) {
      await client.query('SELECT id FROM library_assets WHERE id = $1 AND type = \'world\' FOR UPDATE', [peekOriginWorldId]);
    }

    const current = await client.query('SELECT * FROM library_assets WHERE id = $1 FOR UPDATE', [assetId]);
    if (!current.rowCount || !current.rows[0]) throw new AssetWriteError(404, 'Record not found.');
    const existing = current.rows[0] as Record<string, unknown>;
    if (existing.creator_user_id !== identity.userId && !identity.isSuperAdmin) {
      throw new AssetWriteError(403, 'Only the creator can change this record.');
    }

    if (asset.originWorldId !== undefined && asset.originWorldId !== existing.origin_world_id) {
      if (existing.type === 'world' && asset.originWorldId) throw new AssetWriteError(400, 'A world cannot be moved inside another world.');
      if (existing.type === 'persona' && asset.originWorldId) throw new AssetWriteError(400, 'A Persona is reusable and cannot be moved inside a world.');
      if (isWorldCollectionType(String(existing.type)) && existing.origin_world_id) {
        throw new AssetWriteError(409, 'Move world-owned places/species/factions/societies/families/memories from World Forge so their world link stays atomic.');
      }
      if (asset.originWorldId && !await canAuthorIntoWorld(client, asset.originWorldId, identity.userId, identity.isSuperAdmin)) {
        throw new AssetWriteError(403, 'Only the world owner can move records into this world.');
      }
    }

    if (hooks.beforeUpdate) asset = await hooks.beforeUpdate(client, existing, asset);

    const existingDocument = isRecord(existing.document) ? existing.document : {};
    let nextDocument = asset.document !== undefined ? { ...asset.document } : { ...existingDocument };
    if (existing.origin_world_id && isWorldCollectionType(String(existing.type))) {
      const stableEntryId = typeof existingDocument.worldEntryId === 'string' && existingDocument.worldEntryId.trim()
        ? existingDocument.worldEntryId.trim()
        : assetId;
      nextDocument = { ...nextDocument, worldEntryId: stableEntryId };
    }

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
    if (identityBlock && typeof identityBlock === 'object' && 'name' in (identityBlock as Record<string, unknown>)) {
      (identityBlock as Record<string, unknown>).name = nextAsset.name;
    }
    if (existing.type === 'world') nextAsset.document = normalizeWorldDocument(nextAsset.document);
    if (existing.type === 'world' && asset.document !== undefined) {
      nextAsset.document = restoreRootOwnedCollections(existingDocument, nextAsset.document);
    }
    assertWorldDocumentCollections(String(existing.type), nextAsset.document);
    if (existing.type === 'persona') {
      const existingPersonaSettings = isRecord(existingDocument.personaSettings) ? existingDocument.personaSettings : {};
      nextAsset.document = normalizePersonaDocument(nextAsset.document, source === 'coda' ? existingPersonaSettings : undefined);
    }

    const changedFields: string[] = [];
    if (asset.name !== undefined && asset.name !== existing.name) changedFields.push('name');
    if (asset.summary !== undefined && asset.summary !== existing.summary) changedFields.push('summary');
    if (asset.originWorldId !== undefined && asset.originWorldId !== existing.origin_world_id) changedFields.push('originWorldId');
    if (asset.contentRating !== undefined && asset.contentRating !== existing.content_rating) changedFields.push('contentRating');
    if (asset.tags !== undefined && !jsonSemanticallyEqual(asset.tags, existing.tags)) changedFields.push('tags');
    if (asset.visualTone !== undefined && asset.visualTone !== existing.visual_tone) changedFields.push('visualTone');
    if (asset.document !== undefined && !jsonSemanticallyEqual(nextAsset.document, existingDocument)) changedFields.push('document');

    if (!changedFields.length) {
      const revision = await currentAssetRevision(client, assetId);
      return {
        row: existing,
        result: {
          assetId, type: String(existing.type), name: String(existing.name), revision, operation: 'update' as const, changedFields: [],
          contentRating: String(existing.content_rating), originWorldId: existing.origin_world_id ? String(existing.origin_world_id) : null, created: false,
          updatedAt: new Date(String(existing.updated_at ?? Date.now())).toISOString(),
        },
      };
    }

    if (existing.type === 'world' && asset.document !== undefined) {
      try {
        await removeCanonicalChildrenMissingFromWorld(client, assetId, existingDocument, nextAsset.document);
      } catch (error) {
        if (error instanceof WorldChildRemovalError) {
          throw new AssetWriteError(409, 'Orbis refused to remove a linked world record because doing so would leave ambiguous or dangling canon. Nothing was saved.', error.issues);
        }
        throw error;
      }
    }

    const update = await client.query(
      `UPDATE library_assets SET name=$2, summary=$3, origin_world_id=$4, content_rating=$5, tags=$6, visual_tone=$7, document=$8::jsonb, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [assetId, nextAsset.name, nextAsset.summary, nextAsset.origin_world_id, nextAsset.content_rating, nextAsset.tags, nextAsset.visual_tone, JSON.stringify(nextAsset.document)],
    );
    let row = update.rows[0] as Record<string, unknown>;
    const revision = await recordAssetRevision(client, {
      assetId, operation: 'update', source, changedFields,
      documentBefore: existingDocument, documentAfter: nextAsset.document, performedBy: identity.userId,
    });

    if (row.type === 'world') {
      await syncWorldCollections(client, assetId, identity.userId, row.document as Record<string, unknown>, String(row.content_rating ?? 'sfw'), true, {
        skipKeys: rootOwnedWorldCollections,
      });
      // Root-owned collections keep any unlinked legacy entry rather than having
      // it dropped, because a root save must never delete authored world data.
      await rebuildWorldProjection(client, assetId, { dropUnlinked: true, preserveUnlinkedKeys: rootOwnedWorldCollections });
      const fresh = await client.query('SELECT * FROM library_assets WHERE id = $1', [assetId]);
      row = fresh.rows[0] as Record<string, unknown>;
    } else if (row.origin_world_id && isWorldCollectionType(String(row.type))) {
      const projection = await mirrorCanonicalChildToWorld(client, row);
      await recordProjectionRevision(client, projection, identity.userId);
    }

    return {
      row,
      result: {
        assetId, type: String(row.type), name: String(row.name), revision, operation: 'update', changedFields,
        contentRating: String(row.content_rating), originWorldId: row.origin_world_id ? String(row.origin_world_id) : null, created: false,
        updatedAt: new Date(String(row.updated_at ?? Date.now())).toISOString(),
      },
    };
  });
}
