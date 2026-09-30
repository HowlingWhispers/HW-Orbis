import { Router, type NextFunction, type Request, type Response } from 'express';
import { ZodError, z } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import type { AdminViewPreferenceStore } from './admin-view-preferences.js';
import { ensureSuperAdminAccess, refreshSessionAccess, SUPER_ADMIN_DISCORD_ID } from './auth.js';
import { listCodaLogs, listCodaLogUsers } from './coda-log.js';
import { adminSettingsSchema, SettingsLockoutError, type SettingsStore } from './settings.js';
import {
  CodaDiscordError, cancelCodaScheduledMessage, codaControlSchema, codaDirectMessageSchema, codaDiscordMessageSchema,
  codaMessageEditSchema, codaScheduleSchema, createCodaScheduledMessage, createCodaTemplate, deleteCodaDiscordMessage,
  deleteCodaTemplate, editCodaDiscordMessage, getCodaDiscordStatus, listCodaDiscordChannels, listCodaDiscordMessageHistory,
  listCodaScheduledMessages, listCodaTemplates, searchCodaDiscordMembers, sendCodaDirectMessage, sendCodaDiscordMessage,
  setCodaControlState,
} from './coda-discord.js';
import './types.js';

/**
 * A view preference can only be turned on or off. The safe default (hide other
 * users' private worlds) is applied server-side when no row exists, so an
 * absent or malformed value can never silently widen the filter.
 */
const adminViewPreferenceSchema = z.object({
  hidePrivateUserWorlds: z.boolean().optional(),
}).strict();

export function requireAdmin(config: AppConfig, poolOrSettingsStore: DatabasePool | SettingsStore, maybeSettingsStore?: SettingsStore) {
  const pool = maybeSettingsStore ? poolOrSettingsStore as DatabasePool : undefined;
  const settingsStore = maybeSettingsStore ?? poolOrSettingsStore as SettingsStore;

  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to administer Orbis.' });
      const isSuperAdmin = pool ? await ensureSuperAdminAccess(request, pool) : false;
      if (!isSuperAdmin) await refreshSessionAccess(request, config, settingsStore, pool, true);
      if (!request.session.access?.canAdmin) return response.status(403).json({ error: 'Orbis administrator access is required.' });
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createAdminRouter(
  config: AppConfig,
  pool: DatabasePool,
  settingsStore: SettingsStore,
  adminViewPreferences: AdminViewPreferenceStore,
) {
  const router = Router();

  router.get('/overview', async (_request, response, next) => {
    try {
      await pool.query('SELECT 1');
      const settings = await settingsStore.getEffective();
      response.json({
        status: {
          apiOnline: true,
          databaseConnected: true,
          discordOAuthConfigured: Boolean(config.DISCORD_CLIENT_ID && config.DISCORD_CLIENT_SECRET),
          discordGuildConfigured: Boolean(settings.guildId),
          adultPolicyConfigured: settings.adultRoleIds.length > 0,
          creatorPolicyConfigured: settings.effectiveCreatorRoleIds.length > 0,
          adminPolicyConfigured: settings.adminRoleIds.length > 0 || settings.bootstrapAdminRoleIds.length > 0,
          inviteUrlConfigured: Boolean(settings.inviteUrl),
          codaDiscordConfigured: Boolean(config.CODA_DISCORD_BOT_TOKEN && settings.guildId),
        },
        secrets: {
          databaseUrl: 'configured',
          sessionSecret: 'configured',
          discordClientSecret: config.DISCORD_CLIENT_SECRET ? 'configured' : 'missing',
          codaDiscordBotToken: config.CODA_DISCORD_BOT_TOKEN ? 'configured' : 'missing',
        },
        system: {
          version: config.ORBIS_VERSION,
          buildSha: config.ORBIS_BUILD_SHA || null,
          environment: config.NODE_ENV,
        },
      });
    } catch (error) { next(error); }
  });

  router.get('/settings', async (_request, response, next) => {
    try {
      const settings = await settingsStore.getEffective();
      response.json({
        settings,
        roleResolution: {
          available: false,
          reason: 'Discord OAuth supplies exact member role IDs but does not expose the complete guild role directory. Exact IDs remain authoritative.',
        },
      });
    } catch (error) { next(error); }
  });

  router.put('/settings', async (request, response, next) => {
    try {
      const settings = adminSettingsSchema.parse(request.body);
      const updated = await settingsStore.update(request.session.userId!, settings);
      request.session.access!.checkedAt = 0;
      response.json({ settings: updated });
    } catch (error) {
      if (error instanceof SettingsLockoutError) return response.status(409).json({ error: error.message });
      next(error);
    }
  });

  router.get('/audit', async (request, response, next) => {
    try {
      const requested = typeof request.query.limit === 'string' ? Number(request.query.limit) : 30;
      response.json({ items: await settingsStore.getAudit(Number.isFinite(requested) ? requested : 30) });
    } catch (error) { next(error); }
  });

  /**
   * Per-account adult access grants.
   *
   * Super-admin only, and not merely because requireAdmin passed. Granting
   * adult visibility bypasses the Discord Adult Access role that every other
   * account is bound by, so the ability to hand out that bypass is a recovery
   * capability, not an administrative one. A holder of the Orbis administrator
   * role is explicitly told that administration does not grant adult access,
   * so letting them self-serve one here would contradict the panel's own rule.
   */
  const requireSuperAdmin = async (request: Request, response: Response) => {
    const isSuperAdmin = request.session.discordUserId === SUPER_ADMIN_DISCORD_ID;
    if (!isSuperAdmin) {
      response.status(403).json({ error: 'Only the Orbis super-administrator can grant adult access overrides.' });
      return false;
    }
    return true;
  };

  router.get('/adult-overrides', async (request, response, next) => {
    try {
      if (!await requireSuperAdmin(request, response)) return;
      const query = typeof request.query.query === 'string' ? request.query.query.trim() : '';
      if (query) {
        // Candidate lookup for granting. Bounded and partial-match only: this
        // returns enough to pick an account, never the whole user table.
        const matches = await pool.query(
          `SELECT id, display_name, discord_username, adult_access_override, updated_at, NULL::jsonb AS history
             FROM users
            WHERE display_name ILIKE $1 OR discord_username ILIKE $1
            ORDER BY display_name
            LIMIT 25`,
          [`%${query}%`],
        );
        return response.json({ superAdmin: null, accounts: matches.rows });
      }
      const granted = await pool.query(
        `SELECT u.id, u.display_name, u.discord_username, u.adult_access_override, u.updated_at,
                (SELECT json_agg(json_build_object(
                          'granted', a.granted,
                          'changedAt', a.changed_at,
                          'changedBy', a.changed_by_user_id,
                          'note', a.note
                        ) ORDER BY a.changed_at DESC)
                   FROM adult_access_override_audit a WHERE a.target_user_id = u.id) AS history
           FROM users u
          WHERE u.adult_access_override
          ORDER BY u.display_name`,
      );
      response.json({
        superAdmin: {
          discordId: SUPER_ADMIN_DISCORD_ID,
          note: 'The super-administrator always has adult access via ownerAccess() in server/auth.ts. This is a code-level constant, not a revocable grant, and it is listed here so the mechanism is visible rather than hidden in the source.',
        },
        accounts: granted.rows,
      });
    } catch (error) { next(error); }
  });

  router.patch('/adult-overrides/:userId', async (request, response, next) => {
    try {
      if (!await requireSuperAdmin(request, response)) return;
      const userId = z.string().uuid().parse(request.params.userId);
      const body = z.object({ granted: z.boolean(), note: z.string().max(240).optional() }).strict().parse(request.body ?? {});

      const updated = await pool.query(
        `UPDATE users SET adult_access_override = $2, updated_at = now()
          WHERE id = $1 RETURNING id, display_name, adult_access_override`,
        [userId, body.granted],
      );
      if (!updated.rowCount) return response.status(404).json({ error: 'No such Orbis account.' });

      await pool.query(
        `INSERT INTO adult_access_override_audit (target_user_id, granted, changed_by_user_id, note)
         VALUES ($1, $2, $3, $4)`,
        [userId, body.granted, request.session.userId ?? null, body.note?.trim() || null],
      );
      response.json({ account: updated.rows[0] });
    } catch (error) {
      if (error instanceof ZodError) return response.status(400).json({ error: 'That is not a valid adult access override.', details: error.flatten() });
      next(error);
    }
  });

  /**
   * Super-admin recovery view preferences. These filter what one administrator
   * sees while browsing Orbis. They never change owner visibility, privacy,
   * permissions, publication state or world data.
   */
  router.get('/view-preferences', async (request, response, next) => {
    try {
      response.json({ preferences: await adminViewPreferences.get(request.session.userId!) });
    } catch (error) { next(error); }
  });

  router.put('/view-preferences', async (request, response, next) => {
    try {
      const body = adminViewPreferenceSchema.parse(request.body ?? {});
      response.json({ preferences: await adminViewPreferences.set(request.session.userId!, body) });
    } catch (error) {
      if (error instanceof ZodError) return response.status(400).json({ error: 'That view preference is not a valid Orbis setting.', details: error.flatten() });
      next(error);
    }
  });

  router.get('/coda/channels', async (_request, response, next) => {
    try {
      const settings = await settingsStore.getEffective();
      response.json(await listCodaDiscordChannels(config, settings.guildId));
    } catch (error) {
      if (error instanceof CodaDiscordError) return response.status(error.httpStatus).json({ error: error.message });
      next(error);
    }
  });

  router.get('/coda/messages', async (request, response, next) => {
    try {
      const requested = typeof request.query.limit === 'string' ? Number(request.query.limit) : 20;
      response.json({ items: await listCodaDiscordMessageHistory(pool, Number.isFinite(requested) ? requested : 20) });
    } catch (error) { next(error); }
  });

  router.post('/coda/messages', async (request, response, next) => {
    try {
      const settings = await settingsStore.getEffective();
      const body = codaDiscordMessageSchema.parse(request.body);
      const result = await sendCodaDiscordMessage(config, pool, settings.guildId, request.session.userId!, body);
      response.status(201).json(result);
    } catch (error) {
      if (error instanceof CodaDiscordError) return response.status(error.httpStatus).json({ error: error.message });
      next(error);
    }
  });

  router.patch('/coda/messages/:id', async (request, response, next) => {
    try {
      const body = codaMessageEditSchema.parse(request.body);
      response.json(await editCodaDiscordMessage(config, pool, String(request.params.id), body.content));
    } catch (error) {
      if (error instanceof CodaDiscordError) return response.status(error.httpStatus).json({ error: error.message });
      next(error);
    }
  });

  router.delete('/coda/messages/:id', async (request, response, next) => {
    try {
      response.json(await deleteCodaDiscordMessage(config, pool, String(request.params.id)));
    } catch (error) {
      if (error instanceof CodaDiscordError) return response.status(error.httpStatus).json({ error: error.message });
      next(error);
    }
  });

  router.get('/coda/members', async (request, response, next) => {
    try {
      const settings = await settingsStore.getEffective();
      const query = typeof request.query.query === 'string' ? request.query.query : '';
      response.json({ items: await searchCodaDiscordMembers(config, settings.guildId, query) });
    } catch (error) {
      if (error instanceof CodaDiscordError) return response.status(error.httpStatus).json({ error: error.message });
      next(error);
    }
  });

  router.post('/coda/dms', async (request, response, next) => {
    try {
      const settings = await settingsStore.getEffective();
      const body = codaDirectMessageSchema.parse(request.body);
      const result = await sendCodaDirectMessage(config, pool, settings.guildId, request.session.userId!, body);
      response.status(201).json(result);
    } catch (error) {
      if (error instanceof CodaDiscordError) return response.status(error.httpStatus).json({ error: error.message });
      next(error);
    }
  });

  router.get('/coda/templates', async (_request, response, next) => {
    try { response.json({ items: await listCodaTemplates(pool) }); }
    catch (error) { next(error); }
  });

  router.post('/coda/templates', async (request, response, next) => {
    try { response.status(201).json({ item: await createCodaTemplate(pool, request.session.userId!, request.body) }); }
    catch (error) {
      if (error instanceof CodaDiscordError) return response.status(error.httpStatus).json({ error: error.message });
      next(error);
    }
  });

  router.delete('/coda/templates/:id', async (request, response, next) => {
    try { response.json(await deleteCodaTemplate(pool, String(request.params.id))); }
    catch (error) {
      if (error instanceof CodaDiscordError) return response.status(error.httpStatus).json({ error: error.message });
      next(error);
    }
  });

  router.get('/coda/scheduled', async (_request, response, next) => {
    try { response.json({ items: await listCodaScheduledMessages(pool) }); }
    catch (error) { next(error); }
  });

  router.post('/coda/scheduled', async (request, response, next) => {
    try {
      const body = codaScheduleSchema.parse(request.body);
      response.status(201).json({ item: await createCodaScheduledMessage(config, pool, request.session.userId!, body) });
    } catch (error) {
      if (error instanceof CodaDiscordError) return response.status(error.httpStatus).json({ error: error.message });
      next(error);
    }
  });

  router.delete('/coda/scheduled/:id', async (request, response, next) => {
    try { response.json(await cancelCodaScheduledMessage(pool, String(request.params.id))); }
    catch (error) {
      if (error instanceof CodaDiscordError) return response.status(error.httpStatus).json({ error: error.message });
      next(error);
    }
  });

  router.get('/coda/logs', async (request, response, next) => {
    try {
      const userId = typeof request.query.userId === 'string' && request.query.userId ? request.query.userId : undefined;
      const limit = typeof request.query.limit === 'string' ? Number(request.query.limit) : 100;
      const [items, users] = await Promise.all([listCodaLogs(pool, { ...(userId ? { userId } : {}), limit }), listCodaLogUsers(pool)]);
      response.json({ items, users });
    } catch (error) {
      next(error);
    }
  });

  router.get('/coda/status', async (_request, response, next) => {
    try {
      const settings = await settingsStore.getEffective();
      response.json(await getCodaDiscordStatus(config, pool, settings.guildId));
    } catch (error) {
      if (error instanceof CodaDiscordError) return response.status(error.httpStatus).json({ error: error.message });
      next(error);
    }
  });

  router.put('/coda/control', async (request, response, next) => {
    try {
      const body = codaControlSchema.parse(request.body);
      response.json(await setCodaControlState(pool, request.session.userId!, body.outboundEnabled, body.splitLongMessages));
    } catch (error) { next(error); }
  });

  return router;
}
