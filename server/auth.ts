import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { decideAccess } from './access.js';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import { DiscordMembershipRequestError, discordAuthorizeUrl, discordAvatarUrl, discordDecorationUrl, exchangeCode, getDiscordUser, getGuildMembership } from './discord.js';
import type { SettingsStore } from './settings.js';
import './types.js';

export const SUPER_ADMIN_DISCORD_ID = '1544473372073791602';

const profileSchema = z.object({ displayName: z.string().trim().min(2).max(40) });
const ACCESS_MAX_AGE_MS = 5 * 60 * 1000;
const ACCESS_RETRY_COOLDOWN_MS = 30 * 1000;
const MEMBERSHIP_CONFIRMATION_COOLDOWN_MS = 10 * 1000;
const ACCESS_STALE_GRACE_MS = 15 * 60 * 1000;
const activeAccessRefreshes = new Map<string, Promise<Awaited<ReturnType<typeof evaluateDiscordAccess>>>>();

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const safeReturnTo = (value: unknown) => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';

const noAccess = { isGuildMember: false, canViewAdult: false, canCreate: false, canAdmin: false };
const ownerAccess = () => {
  const now = Date.now();
  return { isGuildMember: true, canViewAdult: true, canCreate: true, canAdmin: true, checkedAt: now, verifiedAt: now };
};

function publicProfile(row: Record<string, unknown>, access: { isGuildMember: boolean; canViewAdult: boolean; canCreate: boolean; canAdmin: boolean }) {
  const isSuperAdmin = String(row.discord_id ?? '') === SUPER_ADMIN_DISCORD_ID;
  return {
    id: row.id,
    displayName: row.display_name,
    discordUsername: row.discord_username,
    avatarUrl: row.avatar_url,
    avatarDecorationUrl: row.avatar_decoration_url,
    accentColor: row.accent_color,
    displayNameCustomized: row.display_name_customized,
    isSuperAdmin,
    permissions: {
      isGuildMember: isSuperAdmin ? true : access.isGuildMember,
      canViewAdult: isSuperAdmin ? true : access.canViewAdult,
      canCreate: isSuperAdmin ? true : access.canCreate,
      canAdmin: isSuperAdmin ? true : access.canAdmin,
    },
  };
}

async function evaluateDiscordAccess(accessToken: string, config: AppConfig, settingsStore: SettingsStore) {
  const settings = await settingsStore.getEffective();
  const membership = settings.guildId
    ? await getGuildMembership(accessToken, settings.guildId)
    : { isGuildMember: false, roles: [] as string[] };
  const access = decideAccess(membership.isGuildMember, membership.roles, {
    adultRoleIds: new Set(settings.adultRoleIds), creatorRoleIds: new Set(settings.effectiveCreatorRoleIds),
    adminRoleIds: new Set(settings.adminRoleIds), bootstrapAdminRoleIds: new Set(settings.bootstrapAdminRoleIds),
  });

  const recoveryGuildId = config.DISCORD_GUILD_ID;
  if (!access.canAdmin && recoveryGuildId && recoveryGuildId !== settings.guildId && settings.bootstrapAdminRoleIds.length > 0) {
    const recoveryMembership = await getGuildMembership(accessToken, recoveryGuildId);
    access.canAdmin = recoveryMembership.isGuildMember && recoveryMembership.roles.some((role) => settings.bootstrapAdminRoleIds.includes(role));
  }
  return access;
}

export async function ensureSuperAdminAccess(request: Request, pool: DatabasePool): Promise<boolean> {
  if (!request.session.userId) return false;

  let discordUserId = request.session.discordUserId;
  if (!discordUserId) {
    const result = await pool.query('SELECT discord_id FROM users WHERE id = $1', [request.session.userId]);
    if (!result.rowCount) return false;
    discordUserId = String(result.rows[0].discord_id ?? '');
    request.session.discordUserId = discordUserId;
  }

  if (discordUserId !== SUPER_ADMIN_DISCORD_ID) return false;
  request.session.access = ownerAccess();
  return true;
}

export async function refreshSessionAccess(request: Request, config: AppConfig, settingsStore: SettingsStore, force = false) {
  if (!request.session.userId) return;
  if (request.session.discordUserId === SUPER_ADMIN_DISCORD_ID) {
    request.session.access = ownerAccess();
    return;
  }
  if (!request.session.discordAccessToken) return;

  const now = Date.now();
  if (request.session.access && (request.session.access.retryAfter ?? 0) > now) return;
  if (!force && request.session.access && now - request.session.access.checkedAt < ACCESS_MAX_AGE_MS) return;
  if ((request.session.discordTokenExpiresAt ?? 0) <= now) {
    request.session.access = { ...noAccess, checkedAt: now };
    return;
  }

  const refreshKey = request.session.userId;
  let refresh = activeAccessRefreshes.get(refreshKey);
  if (!refresh) {
    refresh = evaluateDiscordAccess(request.session.discordAccessToken, config, settingsStore);
    activeAccessRefreshes.set(refreshKey, refresh);
  }
  try {
    const refreshedAccess = await refresh;
    if (!refreshedAccess.isGuildMember && request.session.access?.isGuildMember && !request.session.access.membershipMissingAt) {
      request.session.access = { ...request.session.access, checkedAt: 0, membershipMissingAt: now, retryAfter: now + MEMBERSHIP_CONFIRMATION_COOLDOWN_MS };
      console.warn('Discord membership was reported missing once; retaining verified access until confirmation.');
      return;
    }
    request.session.access = { ...refreshedAccess, checkedAt: now, verifiedAt: now };
  } catch (error) {
    if (!(error instanceof DiscordMembershipRequestError)) throw error;

    const lastVerifiedAt = request.session.access?.verifiedAt ?? request.session.access?.checkedAt ?? 0;
    const canUseLastVerifiedAccess = error.retryable && request.session.access && now - lastVerifiedAt <= ACCESS_STALE_GRACE_MS;
    if (canUseLastVerifiedAccess) {
      request.session.access = { ...request.session.access!, checkedAt: 0, verifiedAt: lastVerifiedAt, retryAfter: now + ACCESS_RETRY_COOLDOWN_MS };
      console.warn(`Discord membership refresh temporarily unavailable (${error.status ?? 'network'}); retaining recently verified access.`);
      return;
    }

    request.session.access = { ...noAccess, checkedAt: now };
    console.warn(`Discord membership refresh denied (${error.status ?? 'network'}); reauthorization may be required.`);
  } finally {
    if (activeAccessRefreshes.get(refreshKey) === refresh) activeAccessRefreshes.delete(refreshKey);
  }
}

export function requireCreator(config: AppConfig, pool: DatabasePool, settingsStore: SettingsStore) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to create in Coda.' });
      const isSuperAdmin = await ensureSuperAdminAccess(request, pool);
      if (!isSuperAdmin) await refreshSessionAccess(request, config, settingsStore);
      if (!request.session.access?.canCreate) return response.status(403).json({ error: 'The verified 18+ Discord role is required to create or edit.', verificationPath: '/verification' });
      await pool.query(
        `UPDATE users SET is_guild_member = $2, can_view_adult = $3, can_create = $4, can_admin = $5, access_checked_at = now(), updated_at = now() WHERE id = $1`,
        [request.session.userId, request.session.access.isGuildMember, request.session.access.canViewAdult, request.session.access.canCreate, request.session.access.canAdmin],
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createAuthRouter(config: AppConfig, pool: DatabasePool, settingsStore: SettingsStore) {
  const router = Router();

  router.get('/discord/login', (request, response, next) => {
    const state = randomBytes(32).toString('base64url');
    request.session.oauthState = state;
    request.session.oauthReturnTo = safeReturnTo(request.query.returnTo);
    request.session.save((error) => {
      if (error) return next(error);
      response.redirect(discordAuthorizeUrl(config, state));
    });
  });

  router.get('/discord/callback', async (request, response, next) => {
    try {
      const code = typeof request.query.code === 'string' ? request.query.code : '';
      const state = typeof request.query.state === 'string' ? request.query.state : '';
      const expectedState = request.session.oauthState ?? '';
      if (!code || !state || !expectedState || !safeEqual(state, expectedState)) return response.redirect('/?auth=invalid-state');

      delete request.session.oauthState;
      const token = await exchangeCode(config, code);
      const [discordUser, evaluatedAccess] = await Promise.all([
        getDiscordUser(token.access_token),
        evaluateDiscordAccess(token.access_token, config, settingsStore),
      ]);
      const access = discordUser.id === SUPER_ADMIN_DISCORD_ID ? ownerAccess() : evaluatedAccess;
      const fallbackName = discordUser.global_name?.trim() || discordUser.username;
      const id = randomUUID();
      const result = await pool.query(
        `INSERT INTO users (
          id, discord_id, discord_username, discord_global_name, display_name, avatar_url,
          avatar_decoration_url, banner_hash, accent_color, collectibles, primary_guild,
          is_guild_member, can_view_adult, can_create, can_admin
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (discord_id) DO UPDATE SET
          discord_username = excluded.discord_username,
          discord_global_name = excluded.discord_global_name,
          display_name = CASE WHEN users.display_name_customized THEN users.display_name ELSE excluded.display_name END,
          avatar_url = excluded.avatar_url,
          avatar_decoration_url = excluded.avatar_decoration_url,
          banner_hash = excluded.banner_hash,
          accent_color = excluded.accent_color,
          collectibles = excluded.collectibles,
          primary_guild = excluded.primary_guild,
          is_guild_member = excluded.is_guild_member,
          can_view_adult = excluded.can_view_adult,
          can_create = excluded.can_create,
          can_admin = excluded.can_admin,
          access_checked_at = now(), updated_at = now(), last_login_at = now()
        RETURNING *`,
        [id, discordUser.id, discordUser.username, discordUser.global_name, fallbackName,
          discordAvatarUrl(discordUser), discordDecorationUrl(discordUser), discordUser.banner ?? null,
          discordUser.accent_color ?? null, discordUser.collectibles ?? null, discordUser.primary_guild ?? null,
          access.isGuildMember, access.canViewAdult, access.canCreate, access.canAdmin],
      );

      const returnTo = request.session.oauthReturnTo ?? '/';
      await new Promise<void>((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
      request.session.userId = String(result.rows[0].id);
      request.session.discordUserId = discordUser.id;
      request.session.discordAccessToken = token.access_token;
      request.session.discordTokenExpiresAt = Date.now() + token.expires_in * 1000;
      const checkedAt = Date.now();
      request.session.access = discordUser.id === SUPER_ADMIN_DISCORD_ID ? ownerAccess() : { ...evaluatedAccess, checkedAt, verifiedAt: checkedAt };
      request.session.save((error) => error ? next(error) : response.redirect(returnTo));
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.json({ user: null });
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [request.session.userId]);
      if (!result.rowCount) return response.json({ user: null });
      request.session.discordUserId = String(result.rows[0].discord_id ?? '');
      const isSuperAdmin = await ensureSuperAdminAccess(request, pool);
      if (!isSuperAdmin) await refreshSessionAccess(request, config, settingsStore);
      const access = request.session.access ?? noAccess;
      response.json({ user: publicProfile(result.rows[0], access) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/profile', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in required.' });
      const body = profileSchema.parse(request.body);
      const result = await pool.query(
        `UPDATE users SET display_name = $2, display_name_customized = true, updated_at = now() WHERE id = $1 RETURNING *`,
        [request.session.userId, body.displayName],
      );
      request.session.discordUserId = String(result.rows[0].discord_id ?? '');
      await ensureSuperAdminAccess(request, pool);
      const access = request.session.access ?? noAccess;
      response.json({ user: publicProfile(result.rows[0], access) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', (request, response, next) => {
    request.session.destroy((error) => {
      if (error) return next(error);
      response.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
      response.status(204).end();
    });
  });

  return router;
}
