import { Router } from 'express';
import { SUPER_ADMIN_DISCORD_ID } from './auth.js';
import type { DatabasePool } from './db.js';

function deletionImpactRows(rows: Array<{ type: string; count: string | number }>) {
  const byType = Object.fromEntries(rows.map((row) => [row.type, Number(row.count)]));
  const totalChildren = Object.values(byType).reduce((sum, count) => sum + count, 0);
  return { totalChildren, byType };
}

export function createWorldDeleteRouter(pool: DatabasePool) {
  const router = Router();

  router.get('/assets/:id/delete-impact', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to inspect deletion impact.' });
      const world = await pool.query('SELECT id, type, name, creator_user_id FROM library_assets WHERE id = $1', [request.params.id]);
      if (!world.rowCount) return response.status(404).json({ error: 'Record not found.' });
      const current = world.rows[0];
      const isSuperAdmin = request.session.discordUserId === SUPER_ADMIN_DISCORD_ID;
      if (current.creator_user_id !== request.session.userId && !isSuperAdmin) return response.status(403).json({ error: 'Only the creator can delete this record.' });
      if (current.type !== 'world') return response.json({ totalChildren: 0, byType: {} });

      const impact = await pool.query(
        'SELECT type, count(*)::int AS count FROM library_assets WHERE origin_world_id = $1 GROUP BY type ORDER BY type',
        [current.id],
      );
      response.json(deletionImpactRows(impact.rows));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/assets/:id', async (request, response, next) => {
    const client = await pool.connect();
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to delete this record.' });
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM library_assets WHERE id = $1 FOR UPDATE', [request.params.id]);
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: 'Record not found.' });
      }

      const asset = result.rows[0];
      const isSuperAdmin = request.session.discordUserId === SUPER_ADMIN_DISCORD_ID;
      if (asset.creator_user_id !== request.session.userId && !isSuperAdmin) {
        await client.query('ROLLBACK');
        return response.status(403).json({ error: 'Only the creator can delete this record.' });
      }

      const cascade = request.body?.cascade === true;
      const confirmName = typeof request.body?.confirmName === 'string' ? request.body.confirmName : '';
      const impactResult = asset.type === 'world'
        ? await client.query('SELECT type, count(*)::int AS count FROM library_assets WHERE origin_world_id = $1 GROUP BY type ORDER BY type', [asset.id])
        : { rows: [] as Array<{ type: string; count: number }> };
      const impact = deletionImpactRows(impactResult.rows);

      if (impact.totalChildren > 0 && !cascade) {
        await client.query('ROLLBACK');
        return response.status(409).json({
          error: `This world still contains ${impact.totalChildren} connected records. Use the destructive world deletion flow to delete the world and its children.`,
          impact,
        });
      }

      if (impact.totalChildren > 0 && confirmName !== asset.name) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: 'World-name confirmation did not match.' });
      }

      if (cascade && asset.type !== 'world') {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: 'Cascade deletion is only available for worlds.' });
      }

      if (cascade && impact.totalChildren > 0) {
        await client.query('DELETE FROM library_assets WHERE origin_world_id = $1', [asset.id]);
      }
      await client.query('DELETE FROM library_assets WHERE id = $1', [asset.id]);
      await client.query('COMMIT');
      response.status(204).end();
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      next(error);
    } finally {
      client.release();
    }
  });

  return router;
}
