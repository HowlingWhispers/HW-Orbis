import { randomUUID } from 'node:crypto';
import type { DatabaseClient, DatabaseExecutor, DatabasePool } from './db.js';
import {
  applyAssetUpdate,
  AssetWriteError,
  insertAsset,
  type CreateAssetInput,
  type AssetWriteSource,
  type UpdateAssetInput,
} from './asset-writes.js';
import {
  isRecord,
  isWorldCollectionType,
  projectionFromAsset,
  worldCollectionSpecs,
  type WorldCollectionKey,
} from './world-entity-sync.js';
import { removeCanonicalChildFromWorldProjection, WorldChildRemovalError } from './world-child-removal.js';

type WriteIdentity = { userId: string; isSuperAdmin: boolean };
export type WorldChildren = Record<WorldCollectionKey, Record<string, unknown>[]>;

const emptyWorldChildren = (): WorldChildren => ({
  locations: [], species: [], factions: [], societies: [], families: [], memories: [],
});

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function childWorldId(row: Record<string, unknown>) {
  return text(row.origin_world_id);
}

export async function listWorldChildren(db: DatabaseExecutor, worldId: string): Promise<WorldChildren> {
  const result = await db.query(
    `SELECT id, type, name, summary, origin_world_id, source_type, content_rating, visual_tone, document
     FROM library_assets
     WHERE origin_world_id = $1 AND type = ANY($2::text[])
     ORDER BY created_at, id`,
    [worldId, worldCollectionSpecs.map((spec) => spec.type)],
  );
  const grouped = emptyWorldChildren();
  for (const row of result.rows as Record<string, unknown>[]) {
    const spec = worldCollectionSpecs.find((candidate) => candidate.type === row.type);
    if (spec) grouped[spec.key].push(projectionFromAsset(spec, row));
  }
  return grouped;
}

async function validatePlaceParent(
  db: DatabaseExecutor,
  worldId: string,
  document: Record<string, unknown>,
  childId?: string,
) {
  const requestedParentId = text(document.parentLocationId);
  if (!requestedParentId) return document;

  const parentResult = await db.query(
    `SELECT id, type, origin_world_id, document
     FROM library_assets
     WHERE id = $1 OR (origin_world_id = $2 AND type = 'place' AND document->>'worldEntryId' = $1)
     ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, id
     LIMIT 2`,
    [requestedParentId, worldId],
  );
  if (parentResult.rowCount !== 1) {
    throw new AssetWriteError(400, 'The parent location does not exist or is ambiguous.');
  }
  const parent = parentResult.rows[0] as Record<string, unknown>;
  if (parent.type !== 'place') throw new AssetWriteError(400, 'The parent must be a Place.');
  if (childWorldId(parent) !== worldId) throw new AssetWriteError(400, 'The parent location must belong to the same world.');
  if (childId && String(parent.id) === childId) throw new AssetWriteError(400, 'A Place cannot be its own parent.');

  const places = await db.query(
    `SELECT id, document FROM library_assets
     WHERE origin_world_id = $1 AND type = 'place'
     ORDER BY created_at, id`,
    [worldId],
  );
  const byIdentifier = new Map<string, Record<string, unknown>>();
  for (const place of places.rows as Record<string, unknown>[]) {
    byIdentifier.set(String(place.id), place);
    const entryId = text(isRecord(place.document) ? place.document.worldEntryId : undefined);
    if (entryId) byIdentifier.set(entryId, place);
  }

  if (childId) {
    let cursor: Record<string, unknown> | undefined = parent;
    const visited = new Set<string>();
    while (cursor) {
      const cursorId = String(cursor.id);
      if (cursorId === childId) throw new AssetWriteError(400, 'That parent would create a location cycle.');
      if (visited.has(cursorId)) throw new AssetWriteError(409, 'The existing location hierarchy contains a cycle.');
      visited.add(cursorId);
      const next = text(isRecord(cursor.document) ? cursor.document.parentLocationId : undefined);
      cursor = next ? byIdentifier.get(next) : undefined;
    }
  }

  const parentDocument = isRecord(parent.document) ? parent.document : {};
  return { ...document, parentLocationId: text(parentDocument.worldEntryId) || String(parent.id) };
}

/**
 * Merge a partial document patch into the current canonical document.
 *
 * Nested plain objects merge recursively so a patch that names one nested key
 * cannot erase its authored siblings. Arrays and scalars replace wholesale,
 * which is what an explicit authored value means.
 */
export function mergeChildDocumentPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = isRecord(value) && isRecord(current[key])
      ? mergeChildDocumentPatch(current[key], value)
      : value;
  }
  return merged;
}

function assertChildType(type: string) {
  if (!isWorldCollectionType(type)) {
    throw new AssetWriteError(400, 'World children must be a Place, Species, Faction, Society, Family, or Memory.');
  }
}

export async function createWorldChild(
  pool: DatabasePool,
  identity: WriteIdentity,
  worldId: string,
  rawInput: unknown,
  source: AssetWriteSource = 'editor',
) {
  return insertAsset(pool, identity, { ...(isRecord(rawInput) ? rawInput : {}), originWorldId: worldId }, source, {
    beforeInsert: async (db, asset: CreateAssetInput) => {
      assertChildType(asset.type);
      if (asset.type !== 'place') return asset;
      return { ...asset, document: await validatePlaceParent(db, worldId, asset.document) };
    },
  });
}

export async function updateWorldChild(
  pool: DatabasePool,
  identity: WriteIdentity,
  worldId: string,
  childId: string,
  rawInput: unknown,
  source: AssetWriteSource = 'editor',
  options: { documentPatch?: boolean } = {},
) {
  return applyAssetUpdate(pool, identity, childId, rawInput, source, {
    beforeUpdate: async (db, existing, asset: UpdateAssetInput) => {
      assertChildType(String(existing.type));
      if (childWorldId(existing) !== worldId) throw new AssetWriteError(404, 'World child not found.');
      if (asset.originWorldId !== undefined && asset.originWorldId !== worldId) {
        throw new AssetWriteError(400, 'Use moveWorldChild to move a child to another world.');
      }
      if (existing.type !== 'place') return asset;
      const existingDocument = isRecord(existing.document) ? existing.document : {};
      const nextDocument = asset.document === undefined
        ? existingDocument
        : options.documentPatch
          ? mergeChildDocumentPatch(existingDocument, asset.document)
          : asset.document;
      if (options.documentPatch && nextDocument.parentLocationId === null) delete nextDocument.parentLocationId;
      return { ...asset, document: await validatePlaceParent(db, worldId, nextDocument, childId) };
    },
  });
}

export async function moveWorldChild(
  pool: DatabasePool,
  identity: WriteIdentity,
  worldId: string,
  childId: string,
  parentLocationId: string | null,
) {
  return updateWorldChild(pool, identity, worldId, childId, {
    document: { parentLocationId },
  }, 'editor', { documentPatch: true });
}

export function patchWorldChild(
  pool: DatabasePool,
  identity: WriteIdentity,
  worldId: string,
  childId: string,
  rawInput: unknown,
  source: AssetWriteSource = 'editor',
) {
  return updateWorldChild(pool, identity, worldId, childId, rawInput, source, { documentPatch: true });
}

export async function deleteWorldChildInTransaction(
  db: DatabaseExecutor,
  identity: WriteIdentity,
  worldId: string,
  child: Record<string, unknown>,
) {
  assertChildType(String(child.type));
  if (childWorldId(child) !== worldId) throw new AssetWriteError(404, 'World child not found.');
  if (child.creator_user_id !== identity.userId && !identity.isSuperAdmin) {
    throw new AssetWriteError(403, 'Only the creator can delete this record.');
  }
  try {
    await removeCanonicalChildFromWorldProjection(db, child);
  } catch (error) {
    if (error instanceof WorldChildRemovalError) {
      throw new AssetWriteError(409, 'Orbis refused this delete because the world link is ambiguous or still referenced. Nothing was deleted.', error.issues);
    }
    throw error;
  }
  await db.query('DELETE FROM library_assets WHERE id = $1', [child.id]);
  await db.query(
    `UPDATE library_assets
     SET dependency_count = (SELECT count(*) FROM library_assets WHERE origin_world_id = $1)
     WHERE id = $1`,
    [worldId],
  );
}

export type ImportedWorldChild = {
  worldId: string;
  type: string;
  name: string;
  summary?: string;
  document: Record<string, unknown>;
  sourceType: string;
  sourceAssetId: string;
  creatorUserId: string;
  contentRating?: string;
  visualTone?: string;
  tags?: unknown[];
};

/**
 * Create one world child from an import, inside the caller's transaction.
 *
 * Importers must not hand-roll a second child writer, but they also must not
 * lose the provenance an editor never supplies: a stable asset id, the
 * `source_type`/`source_asset_id` pair that makes a re-run idempotent, and the
 * authored `worldEntryId`. So this accepts a `DatabaseExecutor` rather than a
 * pool and does not open its own transaction — the import keeps whatever outer
 * transaction it already had.
 *
 * Guarantees:
 * - a child is never created without a real world parent;
 * - a re-run is a no-op and can never overwrite newer authored state;
 * - the inserted document is the same shape an editor write produces.
 */
export async function createImportedWorldChild(
  db: DatabaseExecutor,
  child: ImportedWorldChild,
): Promise<{ id: string; created: boolean }> {
  assertChildType(child.type);

  const world = await db.query('SELECT id FROM library_assets WHERE id = $1 AND type = \'world\'', [child.worldId]);
  if (!world.rowCount) {
    throw new AssetWriteError(409, 'An import cannot create a world record without a real world. Nothing was saved.');
  }

  const existing = await db.query(
    'SELECT id FROM library_assets WHERE source_type = $1 AND source_asset_id = $2',
    [child.sourceType, child.sourceAssetId],
  );
  if (existing.rowCount) {
    return { id: String(existing.rows[0].id), created: false };
  }

  const existingEntryId = text(child.document.worldEntryId);
  const document = { ...child.document, worldEntryId: existingEntryId || randomUUID() };
  const inserted = await db.query(
    `INSERT INTO library_assets
       (id, type, name, summary, origin_world_id, creator_user_id, source_type, source_asset_id,
        content_rating, tags, visual_tone, document)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::json[], $11, $12::jsonb)
     ON CONFLICT (source_type, source_asset_id) WHERE source_asset_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      randomUUID(), child.type, child.name, child.summary ?? '', child.worldId, child.creatorUserId,
      child.sourceType, child.sourceAssetId, child.contentRating ?? 'adult',
      JSON.stringify(child.tags ?? []), child.visualTone ?? 'forest', JSON.stringify(document),
    ],
  );
  if (!inserted.rowCount) {
    const raced = await db.query(
      'SELECT id FROM library_assets WHERE source_type = $1 AND source_asset_id = $2',
      [child.sourceType, child.sourceAssetId],
    );
    return { id: String(raced.rows[0]?.id ?? ''), created: false };
  }
  return { id: String(inserted.rows[0].id), created: true };
}

export async function deleteWorldChild(
  pool: DatabasePool,
  identity: WriteIdentity,
  worldId: string,
  childId: string,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM library_assets WHERE id = $1 AND type = \'world\' FOR UPDATE', [worldId]);
    const result = await client.query('SELECT * FROM library_assets WHERE id = $1 FOR UPDATE', [childId]);
    if (!result.rowCount) throw new AssetWriteError(404, 'World child not found.');
    await deleteWorldChildInTransaction(client, identity, worldId, result.rows[0] as Record<string, unknown>);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    (client as DatabaseClient).release();
  }
}
