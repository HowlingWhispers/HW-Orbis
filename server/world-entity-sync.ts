import { randomUUID } from 'node:crypto';
import type { DatabaseExecutor } from './db.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorldCollectionKey = 'locations' | 'species' | 'factions' | 'societies' | 'families' | 'memories';
export type WorldEntityType = 'place' | 'species' | 'faction' | 'society' | 'family' | 'memory';

type EmbeddedSpec = {
  key: WorldCollectionKey;
  type: WorldEntityType;
  tone: 'mist' | 'forest' | 'ember' | 'river' | 'violet' | 'moon';
  label: string;
  titleField: 'name' | 'title';
};

export const worldCollectionSpecs: readonly EmbeddedSpec[] = [
  { key: 'locations', type: 'place', tone: 'mist', label: 'location', titleField: 'name' },
  { key: 'species', type: 'species', tone: 'forest', label: 'species', titleField: 'name' },
  { key: 'factions', type: 'faction', tone: 'ember', label: 'faction', titleField: 'name' },
  { key: 'societies', type: 'society', tone: 'river', label: 'society', titleField: 'name' },
  { key: 'families', type: 'family', tone: 'violet', label: 'family', titleField: 'name' },
  { key: 'memories', type: 'memory', tone: 'moon', label: 'memory', titleField: 'title' },
] as const;

const specByType = new Map<string, EmbeddedSpec>(worldCollectionSpecs.map((spec) => [spec.type, spec]));
const specByKey = new Map<string, EmbeddedSpec>(worldCollectionSpecs.map((spec) => [spec.key, spec]));

export function worldCollectionKeyForType(type: string) {
  return specByType.get(type)?.key;
}

export function isWorldCollectionType(type: string): type is WorldEntityType {
  return specByType.has(type);
}

export type MalformedCollection = { key: WorldCollectionKey; actual: string };

/**
 * Report world collections that are present but not arrays.
 *
 * A collection is either absent — the world simply has not authored that kind of
 * child yet, which is legitimate — or an array of entries. A present-but-wrongly
 * typed value is a defect. The JSON string `"[]"`, which a legacy import could
 * write, is the case that matters: code that guards with
 * `Array.isArray(value) ? value : []` reads it as an empty collection, so the
 * world reports no drift while refusing every save with "must be an array".
 *
 * Never coerce these. Reporting them is what lets an operator repair the world
 * instead of losing the distinction between "empty" and "broken" on the next
 * write.
 */
export function findMalformedCollections(document: unknown): MalformedCollection[] {
  if (!isRecord(document)) return [];
  const problems: MalformedCollection[] = [];
  for (const spec of worldCollectionSpecs) {
    const value = document[spec.key];
    if (value === undefined || Array.isArray(value)) continue;
    problems.push({ key: spec.key, actual: value === null ? 'null' : typeof value });
  }
  return problems;
}

export function describeMalformedCollections(problems: readonly MalformedCollection[]) {
  return problems.map((problem) => `${problem.key} is ${problem.actual}, not an array`).join('; ');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

export function jsonSemanticallyEqual(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function entityName(spec: EmbeddedSpec, item: Record<string, unknown>) {
  return text(item[spec.titleField]) || text(item.name) || text(item.title);
}

function entitySummary(item: Record<string, unknown>) {
  return (text(item.description) || text(item.currentStatus) || text(item.origin)).slice(0, 2000);
}

function entityDocument(item: Record<string, unknown>, worldEntryId: string) {
  const { libraryAssetId: _libraryAssetId, worldEntryId: _oldWorldEntryId, ...rest } = item;
  return { ...rest, worldEntryId };
}

export function projectionFromAsset(spec: EmbeddedSpec, row: Record<string, unknown>) {
  const document = isRecord(row.document) ? { ...row.document } : {};
  const worldEntryId = text(document.worldEntryId) || String(row.id);
  delete document.worldEntryId;
  delete document.libraryAssetId;

  const projection: Record<string, unknown> = {
    ...document,
    id: worldEntryId,
    libraryAssetId: String(row.id),
  };
  projection[spec.titleField] = String(row.name ?? '');
  if (!text(projection.description) && text(row.summary)) projection.description = String(row.summary);
  return projection;
}

type ManagedMatch = {
  row: Record<string, unknown> | null;
  ambiguous: boolean;
  reason?: string;
};

async function findManagedAsset(
  db: DatabaseExecutor,
  worldId: string,
  spec: EmbeddedSpec,
  worldEntryId: string,
  requestedLibraryAssetId: string,
  name: string,
  allowLegacyNameMatch: boolean,
): Promise<ManagedMatch> {
  if (requestedLibraryAssetId && uuidPattern.test(requestedLibraryAssetId)) {
    const direct = await db.query(
      `SELECT id, name, summary, source_type, content_rating, visual_tone, document
       FROM library_assets
       WHERE id = $1 AND type = $2 AND origin_world_id = $3
       LIMIT 1`,
      [requestedLibraryAssetId, spec.type, worldId],
    );
    if (direct.rowCount) return { row: direct.rows[0] as Record<string, unknown>, ambiguous: false };
  }

  const byEntryId = await db.query(
    `SELECT id, name, summary, source_type, content_rating, visual_tone, document
     FROM library_assets
     WHERE type = $1 AND origin_world_id = $2 AND document->>'worldEntryId' = $3
     ORDER BY id
     LIMIT 2`,
    [spec.type, worldId, worldEntryId],
  );
  if ((byEntryId.rowCount ?? 0) > 1) {
    return {
      row: null,
      ambiguous: true,
      reason: `${spec.label} “${name}” has more than one canonical row for worldEntryId ${worldEntryId}.`,
    };
  }
  if (byEntryId.rowCount === 1) return { row: byEntryId.rows[0] as Record<string, unknown>, ambiguous: false };

  // Name matching exists only for deliberate legacy/backfill work. Normal editor/Coda
  // writes never guess identity from a display name, because duplicate names are valid.
  if (allowLegacyNameMatch) {
    const byName = await db.query(
      `SELECT id, name, summary, source_type, content_rating, visual_tone, document
       FROM library_assets
       WHERE type = $1 AND origin_world_id = $2 AND name = $3
         AND (document->>'worldEntryId' IS NULL OR document->>'worldEntryId' = $4)
       ORDER BY id
       LIMIT 2`,
      [spec.type, worldId, name, worldEntryId],
    );
    if ((byName.rowCount ?? 0) > 1) {
      return {
        row: null,
        ambiguous: true,
        reason: `${spec.label} “${name}” matches multiple legacy rows; refusing to guess.`,
      };
    }
    if (byName.rowCount === 1) return { row: byName.rows[0] as Record<string, unknown>, ambiguous: false };
  }

  return { row: null, ambiguous: false };
}

export class WorldEntitySyncError extends Error {
  constructor(public readonly issues: string[]) {
    super(`World entity synchronization failed: ${issues.join(' ')}`);
    this.name = 'WorldEntitySyncError';
  }
}

export type WorldEntitySyncOptions = {
  allowLegacyNameMatch?: boolean;
  strict?: boolean;
  onlyKeys?: readonly WorldCollectionKey[];
  /**
   * Collections the caller owns and has already handled elsewhere. A skipped
   * collection is never read as canon, so a stale copy submitted through a world
   * root save can never reach a canonical child row.
   */
  skipKeys?: readonly WorldCollectionKey[];
};

export async function syncWorldEmbeddedEntities(
  db: DatabaseExecutor,
  worldId: string,
  userId: string,
  document: Record<string, unknown>,
  contentRating: string,
  options: WorldEntitySyncOptions = {},
) {
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  let linked = 0;
  const skipped = new Set(options.skipKeys ?? []);
  const selectedSpecs = options.onlyKeys?.length
    ? options.onlyKeys.map((key) => specByKey.get(key)).filter((spec): spec is EmbeddedSpec => Boolean(spec))
    : [...worldCollectionSpecs];

  for (const spec of selectedSpecs) {
    if (skipped.has(spec.key)) continue;
    const rawItems = document[spec.key];
    if (rawItems === undefined) continue;
    if (!Array.isArray(rawItems)) {
      errors.push(`${spec.key} must be an array.`);
      continue;
    }

    for (let index = 0; index < rawItems.length; index += 1) {
      const rawItem = rawItems[index];
      if (!isRecord(rawItem)) {
        errors.push(`${spec.label} at index ${index} is not an object.`);
        continue;
      }

      const worldEntryId = text(rawItem.id);
      const name = entityName(spec, rawItem);
      if (!worldEntryId || !name) {
        errors.push(`${spec.label} at index ${index} is missing ${!worldEntryId ? 'id' : spec.titleField}.`);
        continue;
      }

      const requestedLibraryAssetId = text(rawItem.libraryAssetId);
      const summary = entitySummary(rawItem);
      const childDocument = entityDocument(rawItem, worldEntryId);

      try {
        const match = await findManagedAsset(
          db,
          worldId,
          spec,
          worldEntryId,
          requestedLibraryAssetId,
          name,
          options.allowLegacyNameMatch === true,
        );
        if (match.ambiguous) {
          errors.push(match.reason ?? `${spec.label} “${name}” is ambiguous.`);
          continue;
        }

        const existing = match.row;
        let libraryAssetId = existing ? String(existing.id) : '';

        if (!existing) {
          const inserted = await db.query(
            `INSERT INTO library_assets
              (id, type, name, summary, origin_world_id, creator_user_id, source_type, content_rating, tags, visual_tone, document)
             VALUES ($1, $2, $3, $4, $5, $6, 'user-created', $7, '{}', $8, $9::jsonb)
             RETURNING id`,
            [randomUUID(), spec.type, name, summary, worldId, userId, contentRating, spec.tone, JSON.stringify(childDocument)],
          );
          libraryAssetId = String(inserted.rows[0].id);
          created += 1;
        } else {
          const existingDocument = isRecord(existing.document) ? existing.document : {};
          const needsUpdate = String(existing.name ?? '') !== name
            || String(existing.summary ?? '') !== summary
            || String(existing.content_rating ?? '') !== contentRating
            || !jsonSemanticallyEqual(existingDocument, childDocument);

          if (needsUpdate) {
            await db.query(
              `UPDATE library_assets
               SET name = $1, summary = $2, content_rating = $3, document = $4::jsonb, updated_at = now()
               WHERE id = $5`,
              [name, summary, contentRating, JSON.stringify(childDocument), libraryAssetId],
            );
            updated += 1;
          }
        }

        if (requestedLibraryAssetId !== libraryAssetId) {
          rawItem.libraryAssetId = libraryAssetId;
          linked += 1;
        }
      } catch (error) {
        errors.push(`${spec.label} “${name}” (${worldEntryId}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Persist only the structural links we deliberately added. This statement does not
  // bump updated_at; linking metadata is not a user-visible content edit by itself.
  if (linked > 0) {
    await db.query('UPDATE library_assets SET document = $2::jsonb WHERE id = $1 AND type = \'world\'', [worldId, JSON.stringify(document)]);
  }

  await db.query(
    `UPDATE library_assets
     SET dependency_count = (SELECT count(*) FROM library_assets WHERE origin_world_id = $1)
     WHERE id = $1`,
    [worldId],
  );

  if (errors.length) {
    console.warn(`World ${worldId} entity sync warnings:`, errors);
    if (options.strict) throw new WorldEntitySyncError(errors);
  }
  return { created, updated, linked, errors };
}

/**
 * Mirror one canonical child row into the world's compatibility projection.
 * The child row is authoritative; the embedded object is only a projection used by
 * the existing World Forge / Speculus document format.
 */
export async function mirrorCanonicalChildToWorld(db: DatabaseExecutor, row: Record<string, unknown>) {
  const spec = specByType.get(String(row.type ?? ''));
  const worldId = text(row.origin_world_id);
  if (!spec || !worldId) return { changed: false, worldId: '', before: null, after: null };

  let childDocument = isRecord(row.document) ? { ...row.document } : {};
  let worldEntryId = text(childDocument.worldEntryId);
  if (!worldEntryId) {
    worldEntryId = String(row.id);
    childDocument = { ...childDocument, worldEntryId };
    await db.query('UPDATE library_assets SET document = $2::jsonb WHERE id = $1', [row.id, JSON.stringify(childDocument)]);
    row = { ...row, document: childDocument };
  }

  const worldResult = await db.query('SELECT document FROM library_assets WHERE id = $1 AND type = \'world\' FOR UPDATE', [worldId]);
  if (!worldResult.rowCount) throw new Error(`Origin world ${worldId} does not exist.`);
  const before = isRecord(worldResult.rows[0].document) ? worldResult.rows[0].document as Record<string, unknown> : {};
  // Mirroring must not launder a wrongly typed collection. Reading it as empty
  // would replace it with an array holding only this child, silently discarding
  // whatever the malformed value held. Repair the world's types first.
  const malformed = findMalformedCollections(before);
  if (malformed.length) {
    throw new Error(`World ${worldId} has malformed collections and was not mirrored: ${describeMalformedCollections(malformed)}.`);
  }
  const current = Array.isArray(before[spec.key]) ? [...before[spec.key] as unknown[]] : [];
  const projection = projectionFromAsset(spec, row);
  const matches: number[] = [];
  for (let index = 0; index < current.length; index += 1) {
    const entry = current[index];
    if (!isRecord(entry)) continue;
    if (text(entry.libraryAssetId) === String(row.id) || text(entry.id) === worldEntryId) matches.push(index);
  }
  if (matches.length > 1) throw new Error(`${spec.label} ${worldEntryId} appears more than once in the world projection.`);
  if (matches.length === 1) current[matches[0]!] = projection;
  else current.push(projection);

  const after = { ...before, [spec.key]: current };
  if (jsonSemanticallyEqual(before, after)) return { changed: false, worldId, before, after };
  await db.query('UPDATE library_assets SET document = $2::jsonb, updated_at = now() WHERE id = $1', [worldId, JSON.stringify(after)]);
  return { changed: true, worldId, before, after };
}

/**
 * Rebuild collection projections from canonical child rows. Use this after a world
 * edit has been split into child rows so the stored world document cannot drift.
 */
export async function rebuildWorldProjection(
  db: DatabaseExecutor,
  worldId: string,
  options: { dropUnlinked?: boolean; preserveUnlinkedKeys?: readonly WorldCollectionKey[] } = {},
) {
  const worldResult = await db.query('SELECT document FROM library_assets WHERE id = $1 AND type = \'world\' FOR UPDATE', [worldId]);
  if (!worldResult.rowCount) throw new Error(`World ${worldId} does not exist.`);
  const before = isRecord(worldResult.rows[0].document) ? worldResult.rows[0].document as Record<string, unknown> : {};

  // Never rebuild over a wrongly typed collection. Substituting an empty array
  // would silently discard whatever the value held and destroy the difference
  // between "this world has no factions" and "this world's factions are broken".
  const malformed = findMalformedCollections(before);
  if (malformed.length) {
    throw new Error(`World ${worldId} has malformed collections and was not rebuilt: ${describeMalformedCollections(malformed)}.`);
  }

  const childResult = await db.query(
    `SELECT id, type, name, summary, origin_world_id, source_type, content_rating, visual_tone, document
     FROM library_assets
     WHERE origin_world_id = $1 AND type = ANY($2::text[])
     ORDER BY created_at, id`,
    [worldId, worldCollectionSpecs.map((spec) => spec.type)],
  );

  const after: Record<string, unknown> = { ...before };
  const preserveUnlinked = new Set(options.preserveUnlinkedKeys ?? []);
  for (const spec of worldCollectionSpecs) {
    const keepUnlinked = options.dropUnlinked !== true || preserveUnlinked.has(spec.key);
    const children = childResult.rows.filter((row) => row.type === spec.type) as Record<string, unknown>[];
    const byId = new Map(children.map((row) => [String(row.id), row]));
    const byEntry = new Map<string, Record<string, unknown>>();
    for (const row of children) {
      const entryId = text(isRecord(row.document) ? row.document.worldEntryId : undefined);
      if (entryId && !byEntry.has(entryId)) byEntry.set(entryId, row);
    }

    const used = new Set<string>();
    const projected: Record<string, unknown>[] = [];
    const current = Array.isArray(before[spec.key]) ? before[spec.key] as unknown[] : [];
    for (const raw of current) {
      if (!isRecord(raw)) continue;
      const linked = text(raw.libraryAssetId);
      const entryId = text(raw.id);
      const child = (linked ? byId.get(linked) : undefined) ?? (entryId ? byEntry.get(entryId) : undefined);
      if (child && !used.has(String(child.id))) {
        projected.push(projectionFromAsset(spec, child));
        used.add(String(child.id));
      } else if (keepUnlinked) {
        projected.push(raw);
      }
    }
    for (const child of children) {
      if (used.has(String(child.id))) continue;
      projected.push(projectionFromAsset(spec, child));
      used.add(String(child.id));
    }
    after[spec.key] = projected;
  }

  if (!jsonSemanticallyEqual(before, after)) {
    await db.query('UPDATE library_assets SET document = $2::jsonb WHERE id = $1', [worldId, JSON.stringify(after)]);
  }
  return { changed: !jsonSemanticallyEqual(before, after), before, after };
}
