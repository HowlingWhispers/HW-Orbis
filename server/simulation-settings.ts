import { Router } from 'express';
import { z } from 'zod';
import type { DatabasePool } from './db.js';

export const simulationSettingsSchema = z.object({ engine: z.enum(['v1', 'v2', 'v3']) }).strict();
const migrationMissing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';

export async function readSimulationSettings(pool: DatabasePool, userId: string) {
  try {
    const result = await pool.query('SELECT engine FROM user_simulation_settings WHERE user_id = $1', [userId]);
    const engine = result.rows[0]?.engine;
    return { engine: engine === 'v3' ? 'v3' as const : engine === 'v2' ? 'v2' as const : 'v1' as const, available: true };
  } catch (error) {
    // Rolling deployments must not break V1 before the additive migration runs.
    if (migrationMissing(error)) return { engine: 'v1' as const, available: false };
    throw error;
  }
}

export function createSimulationSettingsRouter(pool: DatabasePool) {
  const router = Router();
  router.use((request, response, next) => {
    if (!request.session.userId) return response.status(401).json({ error: 'Sign in to manage your simulation settings.' });
    next();
  });
  router.get('/', async (request, response, next) => {
    try { response.json(await readSimulationSettings(pool, request.session.userId!)); }
    catch (error) { next(error); }
  });
  router.put('/', async (request, response, next) => {
    try {
      const { engine } = simulationSettingsSchema.parse(request.body);
      await pool.query(
        `INSERT INTO user_simulation_settings (user_id, engine) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET engine = excluded.engine, updated_at = now()`,
        [request.session.userId, engine],
      );
      response.json({ engine, available: true });
    } catch (error) {
      if (migrationMissing(error)) return response.status(503).json({ error: 'Simulation preferences are not installed yet. V1 remains available.' });
      next(error);
    }
  });
  return router;
}
