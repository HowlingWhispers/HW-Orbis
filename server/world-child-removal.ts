import type { DatabaseExecutor } from './db.js';
import {
  describeMalformedCollections, findMalformedCollections, isRecord, jsonSemanticallyEqual, worldCollectionSpecs,
} from './world-entity-sync.js';

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export class WorldChildRemovalError extends Error {
  constructor(public readonly issues: string[]) {
    super(`World child removal refused: ${issues.join(' ')}`);
    this.name = 'WorldChildRemovalError';
  }
}

async function findExternalReferences(
  db: DatabaseExecutor,
  childId: string,
  worldId: string,
  worldEntryId: string,
) {
  const needles = [childId, worldEntryId].filter(Boolean);
  if (!needles.length) return [] as Array<Record<string, unknown>>;
  const clauses = needles.map((_, index) => `document::text LIKE $${index + 3}`);
  const result = await db.query(
    `SELECT id, type, name
     FROM library_assets
     WHERE id <> $1 AND id <> $2
       AND (${clauses.join(' OR ')})
     ORDER BY type, name, id
     LIMIT 8`,
    [childId, worldId, ...needles.map((needle) => `%${needle}%`)],
  );
  return result.rows as Array<Record<string, unknown>>;
}

/**
 * A World Forge save is allowed to delete a canonical world child, but only when
 * the old projection names that exact child by libraryAssetId and the new document
 * contains neither that child ID nor its stable worldEntryId. We never infer a
 * deletion from display names.
 */
export async function removeCanonicalChildrenMissingFromWorld(
  db: DatabaseExecutor,
  worldId: string,
  beforeDocument: Record<string, unknown>,
  afterDocument: Record<string, unknown>,
) {
  const issues: string[] = [];
  const removals: Array<{ id: string; type: string; name: string; worldEntryId: string }> = [];

  // Refuse before computing anything. A wrongly typed collection reads as an empty
  // array, so a valid `before` plus a malformed `after` would present every
  // canonical child as "missing from the world" and queue it for deletion with no
  // issue to trip the refusal below. This is the only thing standing between a
  // malformed world document and silent deletion of its children.
  const malformedBefore = findMalformedCollections(beforeDocument);
  const malformedAfter = findMalformedCollections(afterDocument);
  if (malformedBefore.length || malformedAfter.length) {
    const problems = [...malformedBefore.map((p) => `stored ${describeMalformedCollections([p])}`), ...malformedAfter.map((p) => `submitted ${describeMalformedCollections([p])}`)];
    throw new WorldChildRemovalError([`Refusing to evaluate world child removal because ${problems.join('; ')}. Nothing was deleted.`]);
  }

  for (const spec of worldCollectionSpecs) {
    const before = Array.isArray(beforeDocument[spec.key]) ? beforeDocument[spec.key] as unknown[] : [];
    const after = Array.isArray(afterDocument[spec.key]) ? afterDocument[spec.key] as unknown[] : [];
    const afterLibraryIds = new Set<string>();
    const afterEntryIds = new Set<string>();
    for (const raw of after) {
      if (!isRecord(raw)) continue;
      const linked = text(raw.libraryAssetId);
      const entryId = text(raw.id);
      if (linked) afterLibraryIds.add(linked);
      if (entryId) afterEntryIds.add(entryId);
    }

    for (const raw of before) {
      if (!isRecord(raw)) continue;
      const linkedId = text(raw.libraryAssetId);
      const oldEntryId = text(raw.id);
      if (!linkedId) continue; // legacy/unlinked data is never deleted by inference.
      if (afterLibraryIds.has(linkedId) || (oldEntryId && afterEntryIds.has(oldEntryId))) continue;

      const childResult = await db.query(
        `SELECT id, type, name, origin_world_id, document
         FROM library_assets
         WHERE id = $1 AND type = $2 AND origin_world_id = $3
         FOR UPDATE`,
        [linkedId, spec.type, worldId],
      );
      if (childResult.rowCount !== 1) {
        issues.push(`${spec.label} ${oldEntryId || linkedId} has a stale/ambiguous canonical link ${linkedId}; refusing deletion.`);
        continue;
      }

      const child = childResult.rows[0] as Record<string, unknown>;
      const childDocument = isRecord(child.document) ? child.document : {};
      const childEntryId = text(childDocument.worldEntryId);
      if (oldEntryId && childEntryId && childEntryId !== oldEntryId) {
        issues.push(`${spec.label} ${oldEntryId} points to canonical child ${linkedId} whose worldEntryId is ${childEntryId}; refusing deletion.`);
        continue;
      }

      const references = await findExternalReferences(db, linkedId, worldId, childEntryId || oldEntryId);
      if (references.length) {
        const sample = references.map((row) => `${String(row.type)} “${String(row.name)}”`).join(', ');
        issues.push(`${spec.label} “${String(child.name)}” is still referenced by ${sample}; remove those references first.`);
        continue;
      }

      removals.push({ id: linkedId, type: spec.type, name: String(child.name), worldEntryId: childEntryId || oldEntryId });
    }
  }

  if (issues.length) throw new WorldChildRemovalError(issues);
  for (const removal of removals) {
    await db.query('DELETE FROM library_assets WHERE id = $1', [removal.id]);
  }
  return removals;
}

/**
 * Delete-path companion for removing one canonical child directly from its Library
 * page. The exact world projection entry is removed in the same DB transaction.
 */
export async function removeCanonicalChildFromWorldProjection(
  db: DatabaseExecutor,
  child: Record<string, unknown>,
) {
  const worldId = text(child.origin_world_id);
  const spec = worldCollectionSpecs.find((candidate) => candidate.type === String(child.type));
  if (!worldId || !spec) return { changed: false, worldId: '', before: null, after: null };

  const childId = String(child.id);
  const childDocument = isRecord(child.document) ? child.document : {};
  const worldEntryId = text(childDocument.worldEntryId);
  if (!worldEntryId) {
    throw new WorldChildRemovalError([`${spec.label} “${String(child.name)}” has no stable worldEntryId; repair its link before deleting it.`]);
  }

  const references = await findExternalReferences(db, childId, worldId, worldEntryId);
  if (references.length) {
    const sample = references.map((row) => `${String(row.type)} “${String(row.name)}”`).join(', ');
    throw new WorldChildRemovalError([`${spec.label} “${String(child.name)}” is still referenced by ${sample}; remove those references first.`]);
  }

  const world = await db.query('SELECT document FROM library_assets WHERE id = $1 AND type = \'world\' FOR UPDATE', [worldId]);
  if (!world.rowCount) throw new WorldChildRemovalError([`Origin world ${worldId} does not exist.`]);
  const worldDocument = isRecord(world.rows[0].document) ? world.rows[0].document : {};
  const malformed = findMalformedCollections(worldDocument);
  if (malformed.length) {
    throw new WorldChildRemovalError([`Refusing to edit the world projection because ${describeMalformedCollections(malformed)}. Nothing was deleted.`]);
  }
  const before = isRecord(world.rows[0].document) ? world.rows[0].document as Record<string, unknown> : {};
  const current = Array.isArray(before[spec.key]) ? before[spec.key] as unknown[] : [];
  let matches = 0;
  const next = current.filter((raw) => {
    if (!isRecord(raw)) return true;
    const exact = text(raw.libraryAssetId) === childId || text(raw.id) === worldEntryId;
    if (exact) matches += 1;
    return !exact;
  });
  if (matches !== 1) {
    throw new WorldChildRemovalError([`${spec.label} “${String(child.name)}” expected exactly one world projection entry, found ${matches}.`]);
  }

  const after = { ...before, [spec.key]: next };
  if (!jsonSemanticallyEqual(before, after)) {
    await db.query('UPDATE library_assets SET document = $2::jsonb, updated_at = now() WHERE id = $1', [worldId, JSON.stringify(after)]);
  }
  return { changed: true, worldId, before, after };
}
