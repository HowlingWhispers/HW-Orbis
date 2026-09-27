import type { DatabaseExecutor } from './db.js';

/**
 * Canonical child metadata that the world root document must never own.
 *
 * This lives apart from the world-child service and the entity sync on purpose:
 * both of those import the asset write layer, so putting the operation in
 * either would make the write layer import back into them.
 */

/**
 * Propagate a world's content rating to its canonical children.
 *
 * A world child's rating is inherited metadata, not something the child may
 * hold independently, so every canonical child carries the rating of the world
 * that owns it. For the entity-synced collections this happened as a side
 * effect of the sync write. Canonical Places deliberately take no part in
 * root-save synchronization, so they were never re-rated, and a world flipped
 * to adult would have left its Places still readable as sfw. That is an access
 * control gap rather than a cosmetic one, so rating propagation is now stated
 * explicitly here instead of being an accident of which collections happen to
 * be synced.
 *
 * This is a metadata-only operation. It writes `content_rating` on the child
 * rows and nothing else: no authored content, no document, no name, no
 * identity, and never `document.locations`. It creates nothing and deletes
 * nothing. It runs inside the caller's transaction, so a failure anywhere in
 * the surrounding world save rolls the rating change back with everything else
 * rather than leaving a world whose rating and Places disagree.
 *
 * The `IS DISTINCT FROM` guard keeps the statement a no-op when a child already
 * agrees with its world, which is always true for the entity-synced
 * collections, and keeps `updated_at` honest by only moving when the rating
 * genuinely changed.
 */
export async function propagateWorldContentRating(
  db: DatabaseExecutor,
  worldId: string,
  contentRating: string,
): Promise<{ changed: string[] }> {
  const result = await db.query(
    `UPDATE library_assets
        SET content_rating = $2, updated_at = now()
      WHERE origin_world_id = $1
        AND content_rating IS DISTINCT FROM $2
      RETURNING id`,
    [worldId, contentRating],
  );
  return { changed: (result.rows as Record<string, unknown>[]).map((row) => String(row.id)) };
}
