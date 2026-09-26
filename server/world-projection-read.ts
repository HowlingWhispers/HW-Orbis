import type { DatabaseExecutor } from './db.js';
import { isRecord, projectionFromAsset, worldCollectionSpecs } from './world-entity-sync.js';

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read-time safety net: canonical child rows win when an exact identity link exists.
 * Unlinked legacy projection entries are preserved rather than guessed or dropped.
 * Orphan child rows are NOT appended here; normal atomic writes mirror them and the
 * integrity checker reports anything that escaped that contract.
 */
export async function hydrateWorldDocument(
  db: DatabaseExecutor,
  worldId: string,
  baseDocument: unknown,
): Promise<Record<string, unknown>> {
  const document = isRecord(baseDocument) ? { ...baseDocument } : {};
  const children = await db.query(
    `SELECT id, type, name, summary, origin_world_id, source_type, content_rating, visual_tone, document
     FROM library_assets
     WHERE origin_world_id = $1 AND type = ANY($2::text[])
     ORDER BY created_at, id`,
    [worldId, worldCollectionSpecs.map((spec) => spec.type)],
  );

  for (const spec of worldCollectionSpecs) {
    const rows = children.rows.filter((row) => row.type === spec.type) as Record<string, unknown>[];
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const byEntryId = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const entryId = text(isRecord(row.document) ? row.document.worldEntryId : undefined);
      if (!entryId) continue;
      byEntryId.set(entryId, [...(byEntryId.get(entryId) ?? []), row]);
    }

    const current = Array.isArray(document[spec.key]) ? document[spec.key] as unknown[] : [];
    document[spec.key] = current.map((raw) => {
      if (!isRecord(raw)) return raw;
      const libraryAssetId = text(raw.libraryAssetId);
      const entryId = text(raw.id);
      const direct = libraryAssetId ? byId.get(libraryAssetId) : undefined;
      if (direct) return projectionFromAsset(spec, direct);
      const exact = entryId ? byEntryId.get(entryId) ?? [] : [];
      return exact.length === 1 ? projectionFromAsset(spec, exact[0]!) : raw;
    });
  }

  return document;
}
