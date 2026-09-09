import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshSessionAccess } from '../server/auth';
import { loadConfig } from '../server/config';
import { resolveSettings, type SettingsStore } from '../server/settings';

const ids = {
  guild: '1544909655275208716',
  adult: '111111111111111111',
  admin: '222222222222222222',
  recovery: '333333333333333333',
};

const config = loadConfig({
  NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test',
  SESSION_SECRET: 'session-secret-value-that-is-long-enough', DISCORD_CLIENT_ID: 'client-id',
  DISCORD_CLIENT_SECRET: 'client-secret', DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  DISCORD_GUILD_ID: ids.guild, DISCORD_ADULT_ROLE_IDS: ids.adult, DISCORD_CREATOR_ROLE_IDS: '',
  DISCORD_ADMIN_ROLE_IDS: ids.admin, DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS: ids.recovery,
});

const effectiveSettings = resolveSettings(config, {});
const settingsStore = {
  getEffective: async () => effectiveSettings,
  update: async () => effectiveSettings,
  getAudit: async () => [],
} as SettingsStore;

function sessionRequest(userId: string, access = {
  isGuildMember: true, canViewAdult: false, canCreate: false, canAdmin: true,
  checkedAt: 0, verifiedAt: Date.now(),
}) {
  return {
    session: {
      userId,
      discordAccessToken: 'user-access-token',
      discordTokenExpiresAt: Date.now() + 60_000,
      access: { ...access },
    },
  } as unknown as Request;
}

const discordResponse = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as Response;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Discord session permission refresh', () => {
  it('retains recently verified access during a temporary Discord failure', async () => {
    const request = sessionRequest('00000000-0000-4000-8000-000000000011');
    const verifiedAt = request.session.access!.verifiedAt;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(discordResponse(503)));

    await refreshSessionAccess(request, config, settingsStore, true);

    expect(request.session.access).toMatchObject({ isGuildMember: true, canAdmin: true, verifiedAt });
  });

  it('requires a second missing-membership result before revoking verified access', async () => {
    const request = sessionRequest('00000000-0000-4000-8000-000000000012');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(discordResponse(404)));

    await refreshSessionAccess(request, config, settingsStore, true);

    expect(request.session.access).toMatchObject({ isGuildMember: true, canAdmin: true });
    expect(request.session.access?.membershipMissingAt).toEqual(expect.any(Number));

    const confirmationTime = Date.now() + 11_000;
    vi.spyOn(Date, 'now').mockReturnValue(confirmationTime);
    request.session.access!.checkedAt = 0;
    await refreshSessionAccess(request, config, settingsStore, true);

    expect(request.session.access).toMatchObject({ isGuildMember: false, canAdmin: false });
  });

  it('revokes access when Discord rejects the authorization token', async () => {
    const request = sessionRequest('00000000-0000-4000-8000-000000000013');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(discordResponse(401)));

    await refreshSessionAccess(request, config, settingsStore, true);

    expect(request.session.access).toMatchObject({ isGuildMember: false, canAdmin: false });
  });

  it('deduplicates simultaneous Discord membership checks for one user', async () => {
    const first = sessionRequest('00000000-0000-4000-8000-000000000014');
    const second = sessionRequest('00000000-0000-4000-8000-000000000014');
    const fetchMock = vi.fn().mockResolvedValue(discordResponse(200, { roles: [ids.admin] }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      refreshSessionAccess(first, config, settingsStore, true),
      refreshSessionAccess(second, config, settingsStore, true),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.session.access?.canAdmin).toBe(true);
    expect(second.session.access?.canAdmin).toBe(true);
  });
});
