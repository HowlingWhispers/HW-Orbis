import type { DatabaseExecutor } from './db.js';
import { isRecord, worldCollectionSpecs } from './world-entity-sync.js';

export type WorldIntegrityIssue = {
  severity: 'error' | 'warning';
  worldId: string;
  worldName: string;
  collection: string;
  code: string;
  message: string;
};

export type WorldIntegrityReport = {
  worlds: number;
  embeddedEntries: number;
  canonicalRows: number;
  errors: number;
  warnings: number;
  issues: WorldIntegrityIssue[];
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function inspectWorldIntegrity(db: DatabaseExecutor, onlyWorldId?: string): Promise<WorldIntegrityReport> {
  const worldResult = await db.query(
    `SELECT id, name, document
     FROM library_assets
     WHERE type = 'world' AND ($1::uuid IS NULL OR id = $1::uuid)
     ORDER BY name, id`,
    [onlyWorldId || null],
  );

  const issues: WorldIntegrityIssue[] = [];
  let embeddedEntries = 0;
  let canonicalRows = 0;

  for (const world of worldResult.rows) {
    const worldId = String(world.id);
    const worldName = String(world.name ?? worldId);
    const document = isRecord(world.document) ? world.document : {};
    const childResult = await db.query(
      `SELECT id, type, name, source_type, document
       FROM library_assets
       WHERE origin_world_id = $1 AND type = ANY($2::text[])
       ORDER BY type, name, id`,
      [worldId, worldCollectionSpecs.map((spec) => spec.type)],
    );
    canonicalRows += childResult.rowCount ?? childResult.rows.length;

    for (const spec of worldCollectionSpecs) {
      const entries = Array.isArray(document[spec.key]) ? document[spec.key] as unknown[] : [];
      const children = childResult.rows.filter((row) => row.type === spec.type);
      embeddedEntries += entries.length;

      const childById = new Map(children.map((row) => [String(row.id), row]));
      const childrenByEntryId = new Map<string, Record<string, unknown>[]>();
      const childrenByName = new Map<string, Record<string, unknown>[]>();
      for (const row of children) {
        const childDocument = isRecord(row.document) ? row.document : {};
        const entryId = text(childDocument.worldEntryId);
        if (entryId) childrenByEntryId.set(entryId, [...(childrenByEntryId.get(entryId) ?? []), row]);
        const name = String(row.name ?? '');
        childrenByName.set(name, [...(childrenByName.get(name) ?? []), row]);
      }

      const seenEntryIds = new Set<string>();
      const seenLibraryIds = new Set<string>();
      const referencedChildIds = new Set<string>();

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!isRecord(entry)) {
          issues.push({ severity: 'error', worldId, worldName, collection: spec.key, code: 'invalid_embedded_entry', message: `Entry ${index + 1} is not an object.` });
          continue;
        }
        const entryId = text(entry.id);
        const libraryAssetId = text(entry.libraryAssetId);
        const displayName = text(entry[spec.titleField]) || text(entry.name) || text(entry.title) || `entry ${index + 1}`;

        if (!entryId) {
          issues.push({ severity: 'error', worldId, worldName, collection: spec.key, code: 'missing_world_entry_id', message: `${displayName} has no stable world entry id.` });
        } else if (seenEntryIds.has(entryId)) {
          issues.push({ severity: 'error', worldId, worldName, collection: spec.key, code: 'duplicate_world_entry_id', message: `${displayName} repeats world entry id ${entryId}.` });
        } else {
          seenEntryIds.add(entryId);
        }

        if (libraryAssetId) {
          if (seenLibraryIds.has(libraryAssetId)) {
            issues.push({ severity: 'error', worldId, worldName, collection: spec.key, code: 'duplicate_library_link', message: `${displayName} repeats library asset link ${libraryAssetId}.` });
          }
          seenLibraryIds.add(libraryAssetId);
          const child = childById.get(libraryAssetId);
          if (!child) {
            issues.push({ severity: 'error', worldId, worldName, collection: spec.key, code: 'stale_library_link', message: `${displayName} points to missing/wrong ${spec.type} ${libraryAssetId}.` });
          } else {
            referencedChildIds.add(libraryAssetId);
            const childEntryId = text(isRecord(child.document) ? child.document.worldEntryId : undefined);
            if (entryId && childEntryId && childEntryId !== entryId) {
              issues.push({ severity: 'error', worldId, worldName, collection: spec.key, code: 'entry_id_mismatch', message: `${displayName} links ${entryId} to child worldEntryId ${childEntryId}.` });
            }
          }
        } else if (entryId) {
          const exact = childrenByEntryId.get(entryId) ?? [];
          if (exact.length === 1) {
            issues.push({ severity: 'warning', worldId, worldName, collection: spec.key, code: 'missing_back_link', message: `${displayName} has a canonical child but no libraryAssetId back-link.` });
            referencedChildIds.add(String(exact[0]!.id));
          } else if (exact.length > 1) {
            issues.push({ severity: 'error', worldId, worldName, collection: spec.key, code: 'ambiguous_world_entry', message: `${displayName} maps to ${exact.length} canonical rows with worldEntryId ${entryId}.` });
          } else {
            issues.push({ severity: 'error', worldId, worldName, collection: spec.key, code: 'missing_canonical_row', message: `${displayName} has no canonical ${spec.type} row.` });
          }
        }
      }

      for (const [entryId, rows] of childrenByEntryId) {
        if (rows.length > 1) {
          issues.push({ severity: 'error', worldId, worldName, collection: spec.key, code: 'duplicate_canonical_entry_id', message: `${rows.length} ${spec.type} rows claim worldEntryId ${entryId}.` });
        }
      }

      for (const row of children) {
        if (!referencedChildIds.has(String(row.id))) {
          issues.push({ severity: 'warning', worldId, worldName, collection: spec.key, code: 'unprojected_canonical_row', message: `${String(row.name)} (${String(row.id)}) exists in the world but is not referenced by the world projection.` });
        }
      }

      for (const [name, rows] of childrenByName) {
        if (name && rows.length > 1) {
          issues.push({ severity: 'warning', worldId, worldName, collection: spec.key, code: 'duplicate_display_name', message: `${rows.length} ${spec.type} rows share the name “${name}”. Names are not identity; verify these are intentional.` });
        }
      }
    }
  }

  return {
    worlds: worldResult.rowCount ?? worldResult.rows.length,
    embeddedEntries,
    canonicalRows,
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    issues,
  };
}
