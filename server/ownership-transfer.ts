import { Router } from 'express';
import { z } from 'zod';
import type { DatabasePool } from './db.js';

const transferSchema = z.object({
  targetUserId: z.string().uuid(),
  confirmName: z.string().trim().min(1).max(120),
}).strict();

function publicTarget(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    discordUsername: String(row.discord_username),
    discordId: String(row.discord_id),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
  };
}

async function ownedWorld(pool: DatabasePool, worldId: string, userId: string) {
  const result = await pool.query(
    'SELECT id, type, name, creator_user_id, dependency_count FROM library_assets WHERE id = $1',
    [worldId],
  );
  if (!result.rowCount || result.rows[0].type !== 'world') return { status: 404 as const, row: null };
  if (result.rows[0].creator_user_id !== userId) return { status: 403 as const, row: result.rows[0] };
  return { status: 200 as const, row: result.rows[0] };
}

export function createOwnershipTransferRouter(pool: DatabasePool) {
  const router = Router();

  router.get('/assets/:id/transfer-targets', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to transfer a world.' });
      const world = await ownedWorld(pool, request.params.id, request.session.userId);
      if (world.status === 404) return response.status(404).json({ error: 'World not found.' });
      if (world.status === 403) return response.status(403).json({ error: 'Only the current world owner can transfer it.' });

      const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 80) : '';
      if (search.length < 2) return response.json({ items: [] });
      const like = `%${search}%`;
      const result = await pool.query(
        `SELECT id, discord_id, discord_username, display_name, avatar_url
         FROM users
         WHERE id <> $1
           AND can_create = true
           AND (
             discord_id = $2
             OR discord_username ILIKE $3
             OR display_name ILIKE $3
             OR COALESCE(discord_global_name, '') ILIKE $3
           )
         ORDER BY
           CASE
             WHEN discord_id = $2 THEN 0
             WHEN lower(discord_username) = lower($2) THEN 1
             WHEN lower(display_name) = lower($2) THEN 2
             ELSE 3
           END,
           display_name
         LIMIT 10`,
        [request.session.userId, search, like],
      );
      response.json({ items: result.rows.map(publicTarget) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/assets/:id/transfer', async (request, response, next) => {
    const client = await pool.connect();
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to transfer a world.' });
      const input = transferSchema.parse(request.body);
      await client.query('BEGIN');

      const result = await client.query(
        'SELECT id, type, name, creator_user_id FROM library_assets WHERE id = $1 FOR UPDATE',
        [request.params.id],
      );
      if (!result.rowCount || result.rows[0].type !== 'world') {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: 'World not found.' });
      }
      const world = result.rows[0];
      if (world.creator_user_id !== request.session.userId) {
        await client.query('ROLLBACK');
        return response.status(403).json({ error: 'Only the current world owner can transfer it.' });
      }
      if (input.confirmName !== world.name) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: 'World-name confirmation did not match.' });
      }
      if (input.targetUserId === request.session.userId) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: 'That world already belongs to you.' });
      }

      const targetResult = await client.query(
        `SELECT id, discord_id, discord_username, display_name, avatar_url, can_create
         FROM users WHERE id = $1 FOR SHARE`,
        [input.targetUserId],
      );
      if (!targetResult.rowCount || targetResult.rows[0].can_create !== true) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: 'The recipient must be an Orbis creator account.' });
      }
      const target = targetResult.rows[0];

      const children = await client.query(
        'SELECT count(*)::int AS count FROM library_assets WHERE origin_world_id = $1',
        [world.id],
      );
      const childCount = Number(children.rows[0]?.count ?? 0);

      // The creator provenance column is protected by a DB trigger. Only the legacy
      // operational-owner column moves, so Created by remains historically correct.
      await client.query(
        `UPDATE library_assets
         SET creator_user_id = $2,
             updated_at = CASE WHEN id = $1 THEN now() ELSE updated_at END
         WHERE id = $1 OR origin_world_id = $1`,
        [world.id, target.id],
      );

      await client.query(
        `INSERT INTO library_world_ownership_transfers
          (world_id, world_name, from_user_id, to_user_id, transferred_by_user_id, child_count)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [world.id, world.name, request.session.userId, target.id, request.session.userId, childCount],
      );

      await client.query('COMMIT');
      response.json({
        worldId: String(world.id),
        worldName: String(world.name),
        childCount,
        transferredTo: publicTarget(target),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      next(error);
    } finally {
      client.release();
    }
  });

  return router;
}
