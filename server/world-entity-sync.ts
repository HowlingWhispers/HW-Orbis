import { randomUUID } from 'node:crypto';
import type { DatabasePool } from './db.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EmbeddedSpec = {
  key: 'species' | 'factions' | 'societies' | 'families' | 'memories';
  type: 'species' | 'faction' | 'society' | 'family' | 'memory';
  tone: 'forest' | 'ember' | 'river' | 'violet' | 'moon';
  label: string;
};

const embeddedSpecs: EmbeddedSpec[] = [
  { key: 'species', type: 'species', tone: 'forest', label: 'species' },
  { key: 'factions', type: 'faction', tone: 'ember', label: 'faction' },
  { key: 'societies', type: 'society', tone: 'river', label: 'society' },
  { key: 'families', type: 'family', tone: 'violet', label: 'family' },
  { key: 'memories', type: 'memory', tone: 'moon', label: 'memory' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function entityName(item: Record<string, unknown>) {
  return text(item.name) || text(item.title);
}

function entitySummary(item: Record<string, unknown>) {
  return (text(item.description) || text(item.currentStatus) || text(item.origin)).slice(0, 2000);
}

function entityDocument(item: Record<string, unknown>, worldEntryId: string) {
  const { libraryAssetId: _libraryAssetId, ...rest } = item;
  return { ...rest, worldEntryId };
}

async function findManagedAsset(
  pool: DatabasePool,
  worldId: string,
  spec: EmbeddedSpec,
  worldEntryId: string,
  requestedLibraryAssetId: string,
) {
  if (requestedLibraryAssetId && uuidPattern.test(requestedLibraryAssetId)) {
    const direct = await pool.query(
      `SELECT id, name, summary, content_rating, document
       FROM library_assets
       WHERE id = $1 AND type = $2 AND origin_world_id = $3
       LIMIT 1`,
      [requestedLibraryAssetId, spec.type, worldId],
    );
    if (direct.rowCount) return direct.rows[0] as Record<string, unknown>;
  }

  const byEntryId = await pool.query(
    `SELECT id, name, summary, content_rating, document
     FROM library_assets
     WHERE type = $1 AND origin_world_id = $2 AND document->>'worldEntryId' = $3
     LIMIT 1`,
    [spec.type, worldId, worldEntryId],
  );
  return byEntryId.rowCount ? byEntryId.rows[0] as Record<string, unknown> : null;
}

async function attachLibraryAssetId(
  pool: DatabasePool,
  worldId: string,
  collectionKey: EmbeddedSpec['key'],
  worldEntryId: string,
  libraryAssetId: string,
) {
  await pool.query(
    `UPDATE library_assets
     SET document = jsonb_set(
       document,
       '{${collectionKey}}',
       (
         SELECT jsonb_agg(
           CASE
             WHEN item->>'id' = $2
               THEN jsonb_set(item, '{libraryAssetId}', to_jsonb($3::text), true)
             ELSE item
           END
         )
         FROM jsonb_array_elements(COALESCE(document->'${collectionKey}', '[]'::jsonb)) AS item
       ),
       true
     )
     WHERE id = $1`,
    [worldId, worldEntryId, libraryAssetId],
  );
}

export async function syncWorldEmbeddedEntities(
  pool: DatabasePool,
  worldId: string,
  userId: string,
  document: Record<string, unknown>,
  contentRating: string,
) {
  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  let linked = 0;

  for (const spec of embeddedSpecs) {
    const rawItems = document[spec.key];
    if (!Array.isArray(rawItems)) continue;

    for (let index = 0; index < rawItems.length; index += 1) {
      const rawItem = rawItems[index];
      if (!isRecord(rawItem)) {
        errors.push(`${spec.label} at index ${index} is not an object.`);
        continue;
      }

      const worldEntryId = text(rawItem.id);
      const name = entityName(rawItem);
      if (!worldEntryId || !name) {
        errors.push(`${spec.label} at index ${index} is missing ${!worldEntryId ? 'id' : 'name/title'}.`);
        continue;
      }

      const requestedLibraryAssetId = text(rawItem.libraryAssetId);
      const summary = entitySummary(rawItem);
      const childDocument = entityDocument(rawItem, worldEntryId);

      try {
        const existing = await findManagedAsset(pool, worldId, spec, worldEntryId, requestedLibraryAssetId);
        let libraryAssetId = existing ? String(existing.id) : '';

        if (!existing) {
          const inserted = await pool.query(
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
            || JSON.stringify(existingDocument) !== JSON.stringify(childDocument);

          if (needsUpdate) {
            await pool.query(
              `UPDATE library_assets
               SET name = $1, summary = $2, content_rating = $3, document = $4::jsonb, updated_at = now()
               WHERE id = $5`,
              [name, summary, contentRating, JSON.stringify(childDocument), libraryAssetId],
            );
            updated += 1;
          }
        }

        if (requestedLibraryAssetId !== libraryAssetId) {
          await attachLibraryAssetId(pool, worldId, spec.key, worldEntryId, libraryAssetId);
          linked += 1;
        }
      } catch (error) {
        errors.push(`${spec.label} “${name}” (${worldEntryId}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await pool.query(
    `UPDATE library_assets
     SET dependency_count = (SELECT count(*) FROM library_assets WHERE origin_world_id = $1)
     WHERE id = $1`,
    [worldId],
  );

  if (errors.length) console.warn(`World ${worldId} embedded entity sync warnings:`, errors);
  return { created, updated, linked, errors };
}
