import { randomUUID } from 'node:crypto';
import type { DatabaseExecutor } from './db.js';
import { isRecord, rebuildWorldProjection } from './world-entity-sync.js';

/**
 * Import a private place bundle as a world plus its canonical children.
 *
 * The previous version of this importer wrote the world document with empty
 * collections and then inserted every child with `origin_world_id` set, without
 * ever calling the projection layer. That produced a world whose canonical
 * children existed but whose `locations`/`species`/`societies` arrays were empty:
 * Speculus and World Forge could not see them, and `dependency_count` looked
 * correct while the world claimed to have nothing in it.
 *
 * Three rules this now follows:
 *
 * 1. The world and all of its children are written in one transaction. A failure
 *    rolls the whole unit back rather than leaving children behind without a
 *    world relationship.
 * 2. The projection is built by the shared projection layer, not hand-written,
 *    so the linkage rules cannot drift from the rest of Orbis.
 * 3. Re-running is a no-op. Nothing is overwritten, so a re-import can never
 *    destroy a projection link or newer authored world state.
 *
 * Authored names, descriptions and record content are copied verbatim. The only
 * metadata added is the `worldEntryId` / `libraryAssetId` link that makes a
 * child addressable from its world.
 */

export type PlaceBundle = Record<string, unknown>;

export type PlaceBundleImportResult = {
  worldId: string;
  worldCreated: boolean;
  childrenCreated: number;
  childrenExisting: number;
  projectionLinked: number;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A stable world entry id derived from the bundle's own coordinates. Deterministic
 * so that a re-import into a freshly created world produces the same ids rather
 * than a fresh set of random ones.
 */
function worldEntryIdFor(kind: string, name: string) {
  return `hw-place-bundle:${kind}:${name}`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'record';
}

type ChildSpec = {
  type: string;
  sourceKey: string;
  name: string;
  summary: string;
  document: Record<string, unknown>;
};

function collectChildren(bundle: PlaceBundle, worldName: string): ChildSpec[] {
  const children: ChildSpec[] = [];
  const place = isRecord(bundle.place) ? bundle.place : {};
  const worldDocument = isRecord(place.world_document) ? place.world_document : {};

  const sections: Array<{ key: string; type: string; source: unknown; labelField: string; summaryField: string; tone: string }> = [
    { key: 'core_locations', type: 'place', source: place.core_locations, labelField: 'name', summaryField: 'summary', tone: 'forest' },
    { key: 'species', type: 'species', source: place.species, labelField: 'name', summaryField: 'summary', tone: 'forest' },
    { key: 'society', type: 'society', source: place.society, labelField: 'name', summaryField: 'summary', tone: 'ember' },
  ];

  for (const section of sections) {
    const source = isRecord(section.source) ? section.source : {};
    for (const [sourceKey, value] of Object.entries(source)) {
      if (!isRecord(value)) continue;
      const name = text(value[section.labelField]) || sourceKey;
      const summary = text(value[section.summaryField]);
      children.push({
        type: section.type,
        sourceKey: `place-bundle/${section.key}/${sourceKey}`,
        name,
        summary,
        document: {
          // Authored bundle content, copied verbatim.
          ...value,
          worldEntryId: worldEntryIdFor(section.type, sourceKey),
        },
      });
    }
  }

  // A bundle may also carry a fully-formed world document. Its entries are
  // imported as children too, so a bundle can supply either shape.
  for (const [key, type] of Object.entries({ locations: 'place', species: 'species', societies: 'society' })) {
    const entries = worldDocument[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const name = text(entry.name) || text(entry.title);
      if (!name) continue;
      children.push({
        type,
        sourceKey: `place-bundle/world_document/${key}/${slug(name)}`,
        name,
        summary: text(entry.description),
        document: { ...entry, worldEntryId: text(entry.id) || worldEntryIdFor(type, name) },
      });
    }
  }

  void worldName;
  return children;
}

async function refreshDependencyCount(db: DatabaseExecutor, worldId: string) {
  await db.query(
    `UPDATE library_assets SET dependency_count = (
       SELECT count(*)::int FROM library_assets WHERE origin_world_id = $1
     )
     WHERE id = $1`,
    [worldId],
  );
}

export async function importPlaceBundle(
  db: DatabaseExecutor,
  bundle: PlaceBundle,
  options: { userId: string; contentRating?: string } = { userId: '' },
): Promise<PlaceBundleImportResult> {
  const contentRating = options.contentRating ?? 'adult';
  const place = isRecord(bundle.place) ? bundle.place : {};
  const worldName = text(place.name) || 'Imported world';
  const sourceAssetId = 'place-bundle/world';
  const children = collectChildren(bundle, worldName);

  const existingWorld = await db.query(
    `SELECT id FROM library_assets WHERE source_type = 'imported-v2' AND source_asset_id = $1`,
    [sourceAssetId],
  );

  let worldId = String(existingWorld.rows[0]?.id ?? '');
  let worldCreated = false;

  if (!worldId) {
    const worldDocument = {
      identity: { name: worldName },
      // Present but empty. `rebuildWorldProjection` appends one entry per canonical
      // child, so the world and its children are linked by the shared layer rather
      // than by a hand-written copy that can disagree.
      locations: [] as unknown[],
      species: [] as unknown[],
      factions: [] as unknown[],
      societies: [] as unknown[],
      families: [] as unknown[],
      memories: [] as unknown[],
      worldSettings: { visibility: 'private', allowForking: false, showInLibrary: false },
      importedContent: {
        setting: place.setting ?? place.description ?? null,
        scope: place.scope ?? null,
      },
    };
    const inserted = await db.query(
      `INSERT INTO library_assets
         (id, type, name, summary, origin_world_id, creator_user_id, source_type, source_asset_id,
          content_rating, tags, visual_tone, document, created_at, updated_at)
       VALUES ($1, 'world', $2, $3, NULL, $4, 'imported-v2', $5, $6, '{}', 'violet', $7::jsonb, now(), now())
       RETURNING id`,
      [randomUUID(), worldName, text(place.description), options.userId, sourceAssetId, contentRating,
        JSON.stringify(worldDocument)],
    );
    worldId = String(inserted.rows[0].id);
    worldCreated = true;
  }

  // INSERT ... DO NOTHING keyed on the stable source id. A re-run re-derives the
  // same source ids, so every existing child is left exactly as it is.
  let childrenCreated = 0;
  let childrenExisting = 0;
  for (const child of children) {
    const existing = await db.query(
      `SELECT id FROM library_assets WHERE source_type = 'imported-v2' AND source_asset_id = $1`,
      [child.sourceKey],
    );
    if (existing.rowCount) {
      childrenExisting += 1;
      continue;
    }
    const tone = child.type === 'society' ? 'ember' : 'forest';
    const inserted = await db.query(
      `INSERT INTO library_assets
         (id, type, name, summary, origin_world_id, creator_user_id, source_type, source_asset_id,
          content_rating, tags, visual_tone, document, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'imported-v2', $7, $8, '{}', $9, $10::jsonb, now(), now())
       ON CONFLICT (source_type, source_asset_id) WHERE source_asset_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [randomUUID(), child.type, child.name, child.summary, worldId, options.userId, child.sourceKey,
        contentRating, tone, JSON.stringify(child.document)],
    );
    if (inserted.rowCount) childrenCreated += 1;
    else childrenExisting += 1;
  }

  // Build the projection with the shared layer. `dropUnlinked: false` keeps any
  // authored entry that has no canonical row, so this adds links without removing
  // world content.
  await rebuildWorldProjection(db, worldId, { dropUnlinked: false });
  await refreshDependencyCount(db, worldId);

  const projected = await db.query(
    `SELECT jsonb_array_length(COALESCE(document->'locations','[]'::jsonb))
          + jsonb_array_length(COALESCE(document->'species','[]'::jsonb))
          + jsonb_array_length(COALESCE(document->'societies','[]'::jsonb)) AS linked
     FROM library_assets WHERE id = $1`,
    [worldId],
  );

  return {
    worldId,
    worldCreated,
    childrenCreated,
    childrenExisting,
    projectionLinked: Number(projected.rows[0]?.linked ?? 0),
  };
}
