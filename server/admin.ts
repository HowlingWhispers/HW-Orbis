import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import { ensureSuperAdminAccess, refreshSessionAccess } from './auth.js';
import { adminSettingsSchema, SettingsLockoutError, type SettingsStore } from './settings.js';
import './types.js';

export function requireAdmin(config: AppConfig, poolOrSettingsStore: DatabasePool | SettingsStore, maybeSettingsStore?: SettingsStore) {
  const pool = maybeSettingsStore ? poolOrSettingsStore as DatabasePool : undefined;
  const settingsStore = maybeSettingsStore ?? poolOrSettingsStore as SettingsStore;

  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to administer Coda.' });
      const isSuperAdmin = pool ? await ensureSuperAdminAccess(request, pool) : false;
      if (!isSuperAdmin) await refreshSessionAccess(request, config, settingsStore, true);
      if (!request.session.access?.canAdmin) return response.status(403).json({ error: 'Coda administrator access is required.' });
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
        },
        secrets: {
          databaseUrl: 'configured',
          sessionSecret: 'configured',
          discordClientSecret: config.DISCORD_CLIENT_SECRET ? 'configured' : 'missing',
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

  return router;
}
