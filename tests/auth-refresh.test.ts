import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshSessionAccess } from '../server/auth';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';
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

/**
 * The access path re-reads the per-account adult grant on every refresh, so
 * these cases need a pool. Each of them is about how Discord failures are
 * handled, not about the grant, so the stub reports none held.
 */
const poolWith = (adultAccessOverride: boolean) => ({
  query: async () => ({ rows: [{ adult_access_override: adultAccessOverride }] }),
}) as unknown as DatabasePool;
const noOverridePool = poolWith(false);

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

    await refreshSessionAccess(request, config, settingsStore, noOverridePool, true);

    expect(request.session.access).toMatchObject({ isGuildMember: true, canAdmin: true, verifiedAt });
  });

  it('requires a second missing-membership result before revoking verified access', async () => {
    const request = sessionRequest('00000000-0000-4000-8000-000000000012');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(discordResponse(404)));

    await refreshSessionAccess(request, config, settingsStore, noOverridePool, true);

    expect(request.session.access).toMatchObject({ isGuildMember: true, canAdmin: true });
    expect(request.session.access?.membershipMissingAt).toEqual(expect.any(Number));

    const confirmationTime = Date.now() + 11_000;
    vi.spyOn(Date, 'now').mockReturnValue(confirmationTime);
    request.session.access!.checkedAt = 0;
    await refreshSessionAccess(request, config, settingsStore, noOverridePool, true);

    expect(request.session.access).toMatchObject({ isGuildMember: false, canAdmin: false });
  });

  it('revokes access when Discord rejects the authorization token', async () => {
    const request = sessionRequest('00000000-0000-4000-8000-000000000013');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(discordResponse(401)));

    await refreshSessionAccess(request, config, settingsStore, noOverridePool, true);

    expect(request.session.access).toMatchObject({ isGuildMember: false, canAdmin: false });
  });

  it('deduplicates simultaneous Discord membership checks for one user', async () => {
    const first = sessionRequest('00000000-0000-4000-8000-000000000014');
    const second = sessionRequest('00000000-0000-4000-8000-000000000014');
    const fetchMock = vi.fn().mockResolvedValue(discordResponse(200, { roles: [ids.admin] }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      refreshSessionAccess(first, config, settingsStore, noOverridePool, true),
      refreshSessionAccess(second, config, settingsStore, noOverridePool, true),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.session.access?.canAdmin).toBe(true);
    expect(second.session.access?.canAdmin).toBe(true);
  });
});

describe('Per-account adult access override', () => {
  const userId = '00000000-0000-4000-8000-000000000021';
  const noAdultRole = { roles: [ids.admin] };

  it('grants adult viewing on top of a Discord evaluation that withheld it', async () => {
    const request = sessionRequest(userId);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(discordResponse(200, noAdultRole)));

    await refreshSessionAccess(request, config, settingsStore, poolWith(true), true);

    expect(request.session.access).toMatchObject({ canViewAdult: true, adultAccessOverride: true });
  });

  it('leaves adult viewing denied when no grant exists', async () => {
    const request = sessionRequest(userId);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(discordResponse(200, noAdultRole)));

    await refreshSessionAccess(request, config, settingsStore, poolWith(false), true);

    expect(request.session.access).toMatchObject({ canViewAdult: false });
    expect(request.session.access?.adultAccessOverride).toBeUndefined();
  });

  it('applies the grant even when Discord is failing and access is merely retained', async () => {
    // This is the branch the wrapper exists for. Retention short-circuits
    // inside refreshDiscordSessionAccess, so an override folded into that
    // function's success path alone would silently lapse during an outage.
    const request = sessionRequest(userId);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(discordResponse(503)));

    await refreshSessionAccess(request, config, settingsStore, poolWith(true), true);

    expect(request.session.access).toMatchObject({ canViewAdult: true, adultAccessOverride: true });
  });

  it('takes effect on the next request after revocation, without a fresh sign-in', async () => {
    const granted = sessionRequest(userId);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(discordResponse(200, noAdultRole)));
    await refreshSessionAccess(granted, config, settingsStore, poolWith(true), true);
    expect(granted.session.access?.canViewAdult).toBe(true);

    // Same session carried forward, as it would be on the target's next
    // request rather than at a fresh sign-in.
    const afterRevocation = sessionRequest(userId, { ...granted.session.access!, verifiedAt: granted.session.access!.verifiedAt ?? Date.now() });
    await refreshSessionAccess(afterRevocation, config, settingsStore, poolWith(false), true);

    expect(afterRevocation.session.access?.canViewAdult).toBe(false);
  });

  it('never escalates creation or administration alongside adult viewing', async () => {
    // Discord grants nothing here, so adult viewing can only be coming from
    // the override. If the override leaked into other capabilities these
    // would come back true.
    const request = sessionRequest(userId, {
      isGuildMember: false, canViewAdult: false, canCreate: false, canAdmin: false,
      checkedAt: 0, verifiedAt: Date.now(),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(discordResponse(200, { roles: [] })));

    await refreshSessionAccess(request, config, settingsStore, poolWith(true), true);

    expect(request.session.access).toMatchObject({ canViewAdult: true, canCreate: false, canAdmin: false });
  });
});
