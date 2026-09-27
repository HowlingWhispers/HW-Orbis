import type { DatabaseExecutor } from './db.js';
import { isRecord, rebuildWorldProjection, syncWorldEmbeddedEntities, WorldEntitySyncError } from './world-entity-sync.js';

/**
 * Promote a world's embedded locations to canonical `place` rows.
 *
 * The previous implementation inserted the place row and then updated the
 * world's back-link in a separate statement, with no transaction. A failure
 * between the two committed the place row and left it orphaned: the child had
 * `origin_world_id` but the world document had no `libraryAssetId` pointing back
 * at it, and a per-location `catch` logged the error and moved on, so the run
 * reported partial success over inconsistent state.
 *
 * This version delegates to the same sync the editor and Coda use, inside a
 * transaction the caller owns. Either the child rows and the world's back-links
 * are both written, or neither is. It also stops hand-copying three fields into
 * a new child document: `syncWorldEmbeddedEntities` copies the authored entry
 * whole, so `kind`, `parentLocationId`, `description` and any other authored
 * field survive.
 */

export type WorldLocationMigrationResult = {
  worldId: string;
  worldName: string;
  created: number;
  updated: number;
  linked: number;
  alreadyLinked: number;
  errors: string[];
};

export async function migrateWorldLocations(
  db: DatabaseExecutor,
  worldId: string,
  options: { userId?: string; contentRating?: string; dryRun?: boolean } = {},
): Promise<WorldLocationMigrationResult> {
  const worldResult = await db.query(
    `SELECT id, name, creator_user_id, content_rating, document
     FROM library_assets WHERE id = $1 AND type = 'world' FOR UPDATE`,
    [worldId],
  );
  if (!worldResult.rowCount) {
    return { worldId, worldName: worldId, created: 0, updated: 0, linked: 0, alreadyLinked: 0, errors: [`World ${worldId} does not exist.`] };
  }

  const world = worldResult.rows[0] as Record<string, unknown>;
  const worldName = String(world.name ?? worldId);
  const document = isRecord(world.document) ? world.document : {};
  const rawLocations = document.locations;
  if (rawLocations === undefined) {
    return { worldId, worldName, created: 0, updated: 0, linked: 0, alreadyLinked: 0, errors: [] };
  }
  if (!Array.isArray(rawLocations)) {
    // Previously this was read as "no embedded locations" and the world was
    // skipped, which hid the defect rather than reporting it.
    return {
      worldId, worldName, created: 0, updated: 0, linked: 0, alreadyLinked: 0,
      errors: [`World ${worldName} has a locations value that is not a list. Fix it before migrating.`],
    };
  }
  if (!rawLocations.length) {
    return { worldId, worldName, created: 0, updated: 0, linked: 0, alreadyLinked: 0, errors: [] };
  }

  const alreadyLinked = rawLocations.filter((entry) => isRecord(entry) && typeof (entry as Record<string, unknown>).libraryAssetId === 'string').length;

  if (options.dryRun) {
    const unlinked = rawLocations.filter((entry) => !isRecord(entry) || typeof (entry as Record<string, unknown>).libraryAssetId !== 'string').length;
    return { worldId, worldName, created: 0, updated: 0, linked: 0, alreadyLinked, errors: [], planned: unlinked } as WorldLocationMigrationResult;
  }

  const userId = String(options.userId ?? world.creator_user_id ?? '').trim();
  if (!userId) {
    // Never fall back to an empty creator: that reaches PostgreSQL as an invalid
    // uuid and aborts the transaction after the child row has been written.
    return {
      worldId, worldName, created: 0, updated: 0, linked: 0, alreadyLinked,
      errors: [`World ${worldName} has no creator, so its locations cannot be linked. Repair its creator first.`],
    };
  }
  const contentRating = options.contentRating ?? String(world.content_rating ?? 'sfw');

  let created = 0;
  let updated = 0;
  let linked = 0;
  let errors: string[] = [];

  try {
    const outcome = await syncWorldEmbeddedEntities(db, worldId, userId, document, contentRating, {
      onlyKeys: ['locations'],
      // The migration is a repair, so a world whose location names already match
      // existing rows is expected rather than ambiguous.
      allowLegacyNameMatch: true,
      strict: true,
    });
    created = outcome.created;
    updated = outcome.updated;
    linked = outcome.linked;
    errors = [...outcome.errors];
  } catch (error) {
    if (error instanceof WorldEntitySyncError) {
      return { worldId, worldName, created: 0, updated: 0, linked: 0, alreadyLinked, errors: error.issues };
    }
    throw error;
  }

  // Re-link the world document from the canonical rows so the projection matches
  // exactly. `dropUnlinked: false` never removes an authored entry.
  await rebuildWorldProjection(db, worldId, { dropUnlinked: false });

  return { worldId, worldName, created, updated, linked, alreadyLinked, errors };
}
