/**
 * Authenticated Orbis -> Ember launch. No browser cookie sharing between hosts.
 * One-use POST handoff and a linked, revocable Orbis session reference.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { ensureSuperAdminAccess, refreshSessionAccess, SUPER_ADMIN_DISCORD_ID } from './auth.js';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import type { SettingsStore } from './settings.js';
import { canDirectViewAssetRow, isAdultRestrictedAssetRow } from './world-access.js';

const uuid = z.string().uuid();
const ticketSchema = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const linkSchema = z.object({ linkId: uuid }).strict();
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const constantTimeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

function trustedBridge(request: Request, config: AppConfig) {
  const authorization = request.get('authorization') ?? '';
  return config.EMBER_BRIDGE_SECRET.length >= 32 && authorization.startsWith('Bearer ')
    && constantTimeEqual(authorization.slice(7), config.EMBER_BRIDGE_SECRET);
}

async function readLinkedContext(pool: DatabasePool, id: string) {
  const result = await pool.query(`
    SELECT t.id AS link_id, t.user_id, t.mode,
      s.sess AS orbis_session,
      a.id AS asset_id, a.type, a.name, a.summary, a.content_rating,
      a.creator_user_id, a.origin_world_id, a.document,
      origin.document AS origin_world_document, origin.creator_user_id AS origin_world_creator_user_id
    FROM ember_launch_tickets t
    JOIN "session" s ON s.sid = t.orbis_session_id AND s.expire > now()
    JOIN library_assets a ON a.id = t.asset_id AND a.type = t.mode
    LEFT JOIN library_assets origin ON origin.id = a.origin_world_id
    WHERE t.id = $1 AND t.consumed_at IS NOT NULL AND t.session_expires_at > now()
  `, [id]);
  if (!result.rowCount) return null;
  const row = result.rows[0] as Record<string, unknown>;
  const session = record(row.orbis_session);
  const access = record(session.access);
  const superAdmin = session.discordUserId === SUPER_ADMIN_DISCORD_ID;
  if (session.userId !== row.user_id || (!superAdmin && access.isGuildMember !== true)) return null;
  if (!canDirectViewAssetRow(row, String(row.user_id), superAdmin)) return null;
  if (isAdultRestrictedAssetRow(row, String(row.user_id), superAdmin || access.canViewAdult === true)) return null;
  return {
    linkId: String(row.link_id),
    userId: String(row.user_id),
    mode: row.mode as 'character' | 'world',
    asset: {
      id: String(row.asset_id), type: row.type as 'character' | 'world',
      name: String(row.name), summary: String(row.summary ?? ''),
      originWorldId: row.origin_world_id ? String(row.origin_world_id) : null,
    },
  };
}

export function createEmberLaunchRouter(config: AppConfig, pool: DatabasePool, settingsStore: SettingsStore) {
  const router = Router();
  router.post('/assets/:id/ember-launch', async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign into Orbis with Discord first.' });
      if (config.EMBER_BRIDGE_SECRET.length < 32) return response.status(503).json({ error: 'Ember is not connected yet.' });
      const parsed = uuid.safeParse(request.params.id);
      if (!parsed.success) return response.status(404).json({ error: 'Record not found.' });
      const superAdmin = await ensureSuperAdminAccess(request, pool);
      if (!superAdmin) await refreshSessionAccess(request, config, settingsStore, pool);
      if (!superAdmin && request.session.access?.isGuildMember !== true) return response.status(403).json({ error: 'Discord membership required.' });
      const result = await pool.query(`
        SELECT a.*, origin.document AS origin_world_document, origin.creator_user_id AS origin_world_creator_user_id
        FROM library_assets a LEFT JOIN library_assets origin ON origin.id = a.origin_world_id
        WHERE a.id = $1 AND a.type IN ('character', 'world')
      `, [parsed.data]);
      if (!result.rowCount) return response.status(404).json({ error: 'Record not found.' });
      const asset = result.rows[0] as Record<string, unknown>;
      if (!canDirectViewAssetRow(asset, request.session.userId, superAdmin)) return response.status(404).json({ error: 'Record not found.' });
      if (isAdultRestrictedAssetRow(asset, request.session.userId, superAdmin || request.session.access?.canViewAdult === true)) {
        return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
      }
      const ticket = randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + 90_000;
      await pool.query(`
        INSERT INTO ember_launch_tickets
          (id, token_hash, orbis_session_id, user_id, asset_id, mode, expires_at, session_expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [randomUUID(), digest(ticket), request.sessionID, request.session.userId, asset.id, asset.type,
        new Date(expiresAt), new Date(Date.now() + 8 * 60 * 60_000)]);
      return response.status(201).json({ mode: asset.type, ticket, launchUrl: config.EMBER_LAUNCH_URL, expiresAt });
    } catch (error) { return next(error); }
  });
  return router;
}

export function createEmberInternalRouter(config: AppConfig, pool: DatabasePool) {
  const router = Router();
  router.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!trustedBridge(request, config)) return response.status(401).json({ error: 'Unauthorized.' });
    return next();
  });
  router.post('/redeem', async (request, response, next) => {
    try {
      const parsed = ticketSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: 'Invalid ticket.' });
      // Atomic one-time consumption; rejects replay even under concurrent requests.
      const result = await pool.query(`
        UPDATE ember_launch_tickets SET consumed_at = now()
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
        RETURNING id
      `, [digest(parsed.data.ticket)]);
      if (!result.rowCount) return response.status(401).json({ error: 'Expired or already used ticket.' });
      const context = await readLinkedContext(pool, String(result.rows[0].id));
      if (!context) return response.status(403).json({ error: 'Orbis session or asset permission is no longer valid.' });
      return response.json(context);
    } catch (error) { return next(error); }
  });
  router.post('/check', async (request, response, next) => {
    try {
      const parsed = linkSchema.safeParse(request.body);
      if (!parsed.success) return response.status(400).json({ error: 'Invalid session.' });
      const context = await readLinkedContext(pool, parsed.data.linkId);
      if (!context) return response.status(401).json({ error: 'Orbis session expired or permission revoked.' });
      return response.json(context);
    } catch (error) { return next(error); }
  });
  return router;
}
