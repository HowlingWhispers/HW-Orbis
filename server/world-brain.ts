import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { SUPER_ADMIN_DISCORD_ID } from './auth.js';
import type { DatabasePool } from './db.js';

const publishSchema = z.object({
  source: z.string().min(1).max(1_000_000),
  notes: z.string().trim().max(4000).default(''),
}).strict();

const bindingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('standard') }).strict(),
  z.object({ mode: z.literal('custom'), revisionId: z.string().uuid() }).strict(),
]);

function mapRevision(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    kind: String(row.kind),
    revisionNumber: Number(row.revision_number),
    source: String(row.source),
    notes: String(row.notes ?? ''),
    createdAt: new Date(String(row.created_at)).toISOString(),
    publishedAt: new Date(String(row.published_at)).toISOString(),
  };
}

async function requireEditableWorld(request: Request, response: Response, pool: DatabasePool) {
  if (!request.session.userId) {
    response.status(401).json({ error: 'Sign in to manage a World Brain.' });
    return null;
  }
  const result = await pool.query(
    'SELECT id, type, creator_user_id FROM library_assets WHERE id = $1',
    [request.params.id],
  );
  if (!result.rowCount || result.rows[0].type !== 'world') {
    response.status(404).json({ error: 'World not found.' });
    return null;
  }
  const isSuperAdmin = request.session.discordUserId === SUPER_ADMIN_DISCORD_ID;
  if (result.rows[0].creator_user_id !== request.session.userId && !isSuperAdmin) {
    response.status(403).json({ error: 'Only the world owner can manage its World Brain.' });
    return null;
  }
  return result.rows[0] as Record<string, unknown>;
}

export function createWorldBrainRouter(pool: DatabasePool) {
  const router = Router();

  router.get('/assets/:id/world-brain', async (request, response, next) => {
    try {
      if (!await requireEditableWorld(request, response, pool)) return;
      const [binding, revisions] = await Promise.all([
        pool.query(
          'SELECT mode, revision_id, updated_at FROM world_brain_bindings WHERE world_id = $1',
          [request.params.id],
        ),
        pool.query(
          `SELECT id, kind, revision_number, source, notes, created_at, published_at
           FROM world_brain_revisions
           WHERE kind = 'custom' AND world_id = $1
           ORDER BY revision_number DESC`,
          [request.params.id],
        ),
      ]);
      const selected = binding.rows[0];
      response.json({
        mode: selected?.mode === 'custom' ? 'custom' : 'standard',
        selectedRevisionId: selected?.mode === 'custom' ? String(selected.revision_id) : null,
        updatedAt: selected?.updated_at ? new Date(String(selected.updated_at)).toISOString() : null,
        revisions: revisions.rows.map(mapRevision),
      });
    } catch (error) { next(error); }
  });

  router.post('/assets/:id/world-brain/revisions', async (request, response, next) => {
    try {
      if (!await requireEditableWorld(request, response, pool)) return;
      const { source, notes } = publishSchema.parse(request.body);
      const id = randomUUID();
      const created = await pool.query(
        `WITH lock AS (
           SELECT pg_advisory_xact_lock(hashtext($1::text))
         ), next_revision AS (
           SELECT COALESCE(MAX(revision_number), 0) + 1 AS value
           FROM world_brain_revisions, lock
           WHERE kind = 'custom' AND world_id = $1
         )
         INSERT INTO world_brain_revisions
           (id, kind, world_id, revision_number, source, notes, created_by)
         SELECT $2, 'custom', $1, value, $3, $4, $5
         FROM next_revision
         RETURNING id, kind, revision_number, source, notes, created_at, published_at`,
        [request.params.id, id, source, notes, request.session.userId],
      );
      await pool.query(
        `INSERT INTO world_brain_bindings (world_id, mode, revision_id, updated_by)
         VALUES ($1, 'custom', $2, $3)
         ON CONFLICT (world_id) DO UPDATE SET
           mode = 'custom', revision_id = excluded.revision_id,
           updated_by = excluded.updated_by, updated_at = now()`,
        [request.params.id, id, request.session.userId],
      );
      response.status(201).json({ mode: 'custom', selectedRevisionId: id, revision: mapRevision(created.rows[0]) });
    } catch (error) { next(error); }
  });

  router.put('/assets/:id/world-brain/binding', async (request, response, next) => {
    try {
      if (!await requireEditableWorld(request, response, pool)) return;
      const input = bindingSchema.parse(request.body);
      if (input.mode === 'custom') {
        const revision = await pool.query(
          `SELECT id FROM world_brain_revisions
           WHERE id = $1 AND kind = 'custom' AND world_id = $2`,
          [input.revisionId, request.params.id],
        );
        if (!revision.rowCount) return response.status(400).json({ error: 'That World Brain revision does not belong to this world.' });
      }
      const revisionId = input.mode === 'custom' ? input.revisionId : null;
      await pool.query(
        `INSERT INTO world_brain_bindings (world_id, mode, revision_id, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (world_id) DO UPDATE SET
           mode = excluded.mode, revision_id = excluded.revision_id,
           updated_by = excluded.updated_by, updated_at = now()`,
        [request.params.id, input.mode, revisionId, request.session.userId],
      );
      response.json({ mode: input.mode, selectedRevisionId: revisionId });
    } catch (error) { next(error); }
  });

  return router;
}
