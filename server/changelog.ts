import { Router } from 'express';
import { z } from 'zod';
import type { DatabasePool } from './db.js';
import {
  compareChangelogVersions,
  latestChangelogEntry,
  publicChangelogEntries,
  unreadChangelogEntries,
  type PublicChangelogPayload,
} from './public-changelog.js';

/**
 * The changelog must never stop Orbis from loading.
 *
 * Reading the published changelog is public and needs no database, so a
 * database outage cannot hide it. Acknowledgement is a convenience: when its
 * table is missing or the query fails, the caller is told the state is
 * unavailable and the UI simply skips the automatic notice instead of
 * blocking the Library.
 */
const migrationMissing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';

const acknowledgementSchema = z.object({ version: z.string().trim().min(1).max(64) }).strict();

export const NO_ACKNOWLEDGEMENT = '';

/** The published changelog. `unreadVersions` is filled in per request. */
export function createChangelogPayload(unreadVersions: string[] | null = null): PublicChangelogPayload {
  return { latest: latestChangelogEntry(), entries: publicChangelogEntries, unreadVersions };
}

export async function readAcknowledgedChangelogVersion(pool: DatabasePool, userId: string) {
  try {
    const result = await pool.query(
      'SELECT acknowledged_version FROM user_changelog_state WHERE user_id = $1',
      [userId],
    );
    return { version: String(result.rows[0]?.acknowledged_version ?? NO_ACKNOWLEDGEMENT), available: true };
  } catch (error) {
    if (migrationMissing(error)) return { version: NO_ACKNOWLEDGEMENT, available: false };
    throw error;
  }
}

export function createChangelogRouter(pool: DatabasePool) {
  const router = Router();

  // Public: reading the changelog never requires an account.
  //
  // When signed in, the response also says which versions are newer than this
  // account's acknowledgement, so the browser never has to re-implement version
  // ordering. If that read fails the field is null and the UI skips the
  // automatic notice rather than guessing.
  router.get('/', async (request, response, next) => {
    try {
      let unreadVersions: string[] | null = null;
      if (request.session.userId) {
        const acknowledged = await readAcknowledgedChangelogVersion(pool, request.session.userId);
        if (acknowledged.available) {
          unreadVersions = unreadChangelogEntries(acknowledged.version).map((entry) => entry.version);
        }
      }
      response.json(createChangelogPayload(unreadVersions));
    } catch (error) {
      // A failing acknowledgement must not hide the public changelog either.
      try {
        response.json(createChangelogPayload(null));
      } catch {
        next(error);
      }
    }
  });

  // Acknowledgement is account-backed, so it does require a session.
  router.get('/acknowledgement', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in to read your changelog acknowledgement.' });
      response.json(await readAcknowledgedChangelogVersion(pool, request.session.userId));
    } catch (error) {
      next(error);
    }
  });

  router.put('/acknowledgement', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in to acknowledge the changelog.' });
      const parsed = acknowledgementSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: 'Acknowledge a valid changelog version.' });

      // Never let a stale or hand-crafted client move the marker backwards;
      // doing so could re-show an update that was already read.
      const known = publicChangelogEntries.some((entry) => entry.version === parsed.data.version);
      if (!known) return response.status(400).json({ error: 'That changelog version is not published.' });

      const current = await readAcknowledgedChangelogVersion(pool, request.session.userId);
      if (current.available && compareChangelogVersions(parsed.data.version, current.version) < 0) {
        return response.json({ version: current.version, available: current.available });
      }

      await pool.query(
        `INSERT INTO user_changelog_state (user_id, acknowledged_version, acknowledged_at, updated_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (user_id) DO UPDATE
           SET acknowledged_version = excluded.acknowledged_version,
               acknowledged_at = excluded.acknowledged_at,
               updated_at = excluded.updated_at`,
        [request.session.userId, parsed.data.version],
      );
      response.json({ version: parsed.data.version, available: true });
    } catch (error) {
      if (migrationMissing(error)) return response.status(503).json({ error: 'Changelog acknowledgement is not installed yet.' });
      next(error);
    }
  });

  return router;
}
