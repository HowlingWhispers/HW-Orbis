import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import { ensureSuperAdminAccess, refreshSessionAccess } from './auth.js';
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

export function requireAdmin(config: AppConfig, poolOrSettingsStore: DatabasePool | SettingsStore, maybeSettingsStore?: SettingsStore) {
  const pool = maybeSettingsStore ? poolOrSettingsStore as DatabasePool : undefined;
  const settingsStore = maybeSettingsStore ?? poolOrSettingsStore as SettingsStore;

  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to administer Orbis.' });
      const isSuperAdmin = pool ? await ensureSuperAdminAccess(request, pool) : false;
      if (!isSuperAdmin) await refreshSessionAccess(request, config, settingsStore, true);
      if (!request.session.access?.canAdmin) return response.status(403).json({ error: 'Orbis administrator access is required.' });
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createAdminRouter(config: AppConfig, pool: DatabasePool, settingsStore: SettingsStore) {
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
