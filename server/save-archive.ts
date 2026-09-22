import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { SUPER_ADMIN_DISCORD_ID } from './auth.js';
import type { DatabasePool } from './db.js';
import { canDirectViewAssetRow } from './world-access.js';

const identitySchema = z.object({ id: z.string().uuid(), revision: z.string().min(1).max(200), name: z.string().min(1).max(200) });
const saveSourceSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1).max(40),
  revision: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
  world: identitySchema.nullable().optional(),
  location: identitySchema.nullable().optional(),
  persona: z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200) }).optional(),
  character: z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200) }).nullable().optional(),
  elapsedSeconds: z.number().int().nonnegative().safe().optional(),
  simulationDay: z.number().int().positive().safe().optional(),
}).passthrough();

const saveSchema = z.union([
  z.object({
    format: z.literal('speculus-v3-session'),
    version: z.literal(3),
    engine: z.literal('v3'),
    source: saveSourceSchema,
    turns: z.array(z.unknown()).max(20000),
  }).passthrough(),
  z.object({
    format: z.literal('speculus-v2-session'),
    version: z.literal(2),
    engine: z.literal('v2'),
    source: saveSourceSchema,
    turns: z.array(z.unknown()).max(20000),
  }).passthrough(),
]);
const uploadSchema = z.object({ save: saveSchema, title: z.string().trim().min(1).max(120).optional() });
const renameSchema = z.object({ title: z.string().trim().min(1).max(120) });

type SaveRow = Record<string, unknown>;

function compatibility(row: SaveRow) {
  if (!row.current_source_id) return 'incompatible';
  const currentRevision = new Date(String(row.current_source_updated_at)).toISOString();
  return currentRevision === row.source_revision ? 'ready' : 'historical-revision-required';
}

function publicSave(row: SaveRow) {
  return {
    id: String(row.id),
    worldId: row.world_id ? String(row.world_id) : null,
    worldName: String(row.world_name),
    sourceAssetId: String(row.source_asset_id),
    sourceType: String(row.source_type),
    sourceRevision: String(row.source_revision),
    sourceName: String(row.source_name),
    title: String(row.title),
    characterId: row.character_id ? String(row.character_id) : null,
    characterName: row.character_name ? String(row.character_name) : null,
    locationId: row.location_id ? String(row.location_id) : null,
    locationName: row.location_name ? String(row.location_name) : null,
    elapsedSeconds: Number(row.elapsed_seconds),
    simulationDay: Number(row.simulation_day ?? 1),
    turnCount: Number(row.turn_count),
    format: String(row.save_format),
    compatibility: compatibility(row),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

async function worldFor(pool: DatabasePool, worldId: string, userId: string, discordUserId?: string) {
  const result = await pool.query('SELECT * FROM library_assets WHERE id = $1 AND type = $2', [worldId, 'world']);
  if (!result.rowCount) return null;
  const world = result.rows[0];
  const isSuperAdmin = discordUserId === SUPER_ADMIN_DISCORD_ID;
  return canDirectViewAssetRow(world, userId, isSuperAdmin) ? world : null;
}

const selectColumns = `s.*, current.id AS current_source_id, current.updated_at AS current_source_updated_at`;
const selectJoin = `FROM speculus_saves s LEFT JOIN library_assets current ON current.id = s.source_asset_id`;

export function createSaveArchiveRouter(pool: DatabasePool) {
  const router = Router();

  router.get('/assets/:worldId/saves', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to open your save archive.' });
      const world = await worldFor(pool, request.params.worldId, request.session.userId, request.session.discordUserId);
      if (!world) return response.status(404).json({ error: 'World not found.' });
      const result = await pool.query(
        `SELECT ${selectColumns} ${selectJoin} WHERE s.user_id = $1 AND s.world_id = $2 ORDER BY s.updated_at DESC`,
        [request.session.userId, world.id],
      );
      response.json({ world: { id: String(world.id), name: String(world.name) }, saves: result.rows.map(publicSave) });
    } catch (error) { next(error); }
  });

  router.post('/assets/:worldId/saves', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to archive a save.' });
      const world = await worldFor(pool, request.params.worldId, request.session.userId, request.session.discordUserId);
      if (!world) return response.status(404).json({ error: 'World not found.' });
      const input = uploadSchema.parse(request.body);
      const save = input.save;
      const sourceResult = await pool.query('SELECT id, type, name, updated_at, origin_world_id FROM library_assets WHERE id = $1', [save.source.id]);
      if (!sourceResult.rowCount) return response.status(409).json({ error: 'The save source record no longer exists in Orbis.' });
      const source = sourceResult.rows[0];
      const sourceWorldId = source.type === 'world' ? String(source.id) : source.origin_world_id ? String(source.origin_world_id) : null;
      const declaredWorldId = save.source.world?.id ?? null;
      if (sourceWorldId !== String(world.id) || (declaredWorldId && declaredWorldId !== String(world.id))) {
        return response.status(409).json({ error: `This save does not belong to ${world.name}.` });
      }
      const defaultTitle = `${save.source.location?.name ?? source.name} · ${save.source.persona?.name ?? 'Session'}`;
      const id = randomUUID();
      await pool.query(
        `INSERT INTO speculus_saves (
          id, user_id, world_id, world_name, source_asset_id, source_type, source_revision, source_name, title,
          character_id, character_name, location_id, location_name, elapsed_seconds, simulation_day, turn_count, save_format, payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`,
        [
          id, request.session.userId, world.id, world.name, source.id, source.type, save.source.revision,
          save.source.name ?? source.name, input.title ?? defaultTitle,
          save.source.character?.id ?? null, save.source.character?.name ?? null,
          save.source.location?.id ?? null, save.source.location?.name ?? null,
          save.source.elapsedSeconds ?? 0, save.source.simulationDay ?? 1, save.turns.length, save.format, JSON.stringify(save),
        ],
      );
      const result = await pool.query(`SELECT ${selectColumns} ${selectJoin} WHERE s.id = $1 AND s.user_id = $2`, [id, request.session.userId]);
      response.status(201).json(publicSave(result.rows[0]));
    } catch (error) { next(error); }
  });

  router.get('/saves/:id', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to open a save.' });
      const result = await pool.query(`SELECT ${selectColumns} ${selectJoin} WHERE s.id = $1 AND s.user_id = $2`, [request.params.id, request.session.userId]);
      if (!result.rowCount) return response.status(404).json({ error: 'Save not found.' });
      response.json(publicSave(result.rows[0]));
    } catch (error) { next(error); }
  });

  router.get('/saves/:id/download', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to download a save.' });
      const result = await pool.query('SELECT title, payload FROM speculus_saves WHERE id = $1 AND user_id = $2', [request.params.id, request.session.userId]);
      if (!result.rowCount) return response.status(404).json({ error: 'Save not found.' });
      const filename = String(result.rows[0].title).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'Speculus-save';
      response.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      response.type('application/json').send(JSON.stringify(result.rows[0].payload, null, 2));
    } catch (error) { next(error); }
  });

  router.patch('/saves/:id', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to rename a save.' });
      const input = renameSchema.parse(request.body);
      const result = await pool.query(
        'UPDATE speculus_saves SET title = $1, updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING id',
        [input.title, request.params.id, request.session.userId],
      );
      if (!result.rowCount) return response.status(404).json({ error: 'Save not found.' });
      const refreshed = await pool.query(`SELECT ${selectColumns} ${selectJoin} WHERE s.id = $1 AND s.user_id = $2`, [request.params.id, request.session.userId]);
      response.json(publicSave(refreshed.rows[0]));
    } catch (error) { next(error); }
  });

  router.post('/saves/:id/duplicate', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to duplicate a save.' });
      const id = randomUUID();
      const copied = await pool.query(
        `INSERT INTO speculus_saves (
          id,user_id,world_id,world_name,source_asset_id,source_type,source_revision,source_name,title,
          character_id,character_name,location_id,location_name,elapsed_seconds,simulation_day,turn_count,save_format,payload
        ) SELECT $1,user_id,world_id,world_name,source_asset_id,source_type,source_revision,source_name,title || ' copy',
          character_id,character_name,location_id,location_name,elapsed_seconds,simulation_day,turn_count,save_format,payload
          FROM speculus_saves WHERE id = $2 AND user_id = $3 RETURNING id`,
        [id, request.params.id, request.session.userId],
      );
      if (!copied.rowCount) return response.status(404).json({ error: 'Save not found.' });
      const result = await pool.query(`SELECT ${selectColumns} ${selectJoin} WHERE s.id = $1 AND s.user_id = $2`, [id, request.session.userId]);
      response.status(201).json(publicSave(result.rows[0]));
    } catch (error) { next(error); }
  });

  router.delete('/saves/:id', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to delete a save.' });
      const result = await pool.query('DELETE FROM speculus_saves WHERE id = $1 AND user_id = $2', [request.params.id, request.session.userId]);
      if (!result.rowCount) return response.status(404).json({ error: 'Save not found.' });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  return router;
}
