import { Router } from 'express';
import { z } from 'zod';
import type { DatabasePool } from './db.js';

const runtimePreferencesSchema = z.object({
  pronouns: z.enum(['he/him', 'she/her', 'they/them', 'it/its']).nullable(),
  responseLength: z.enum(['concise', 'normal', 'long', 'adaptive']),
});

function publicPreferences(row: Record<string, unknown>) {
  return {
    pronouns: row.player_pronouns == null ? null : String(row.player_pronouns),
    responseLength: String(row.response_length_mode ?? 'adaptive'),
  };
}

export function createRuntimePreferencesRouter(pool: DatabasePool) {
  const router = Router();

  router.get('/', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in required.' });
      const result = await pool.query('SELECT player_pronouns, response_length_mode FROM users WHERE id = $1', [request.session.userId]);
      if (!result.rowCount) return response.status(404).json({ error: 'Account not found.' });
      response.json(publicPreferences(result.rows[0]));
    } catch (error) { next(error); }
  });

  router.patch('/', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in required.' });
      const body = runtimePreferencesSchema.parse(request.body);
      const result = await pool.query(
        `UPDATE users
         SET player_pronouns = $2, response_length_mode = $3, updated_at = now()
         WHERE id = $1
         RETURNING player_pronouns, response_length_mode`,
        [request.session.userId, body.pronouns, body.responseLength],
      );
      if (!result.rowCount) return response.status(404).json({ error: 'Account not found.' });
      response.json(publicPreferences(result.rows[0]));
    } catch (error) { next(error); }
  });

  return router;
}
