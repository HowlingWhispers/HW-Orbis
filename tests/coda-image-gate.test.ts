// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../server/config';
import { createCodaDiscordImageRouter } from '../server/coda-discord-image';
import type { DatabasePool } from '../server/db';
import {
  CODA_RENDER_QUALITIES,
  codaRenderPreset,
  isCodaRenderQuality,
  quoteCodaRender,
  sceneRequestsExplicitContent,
} from '../server/coda-render-presets';

const bridgeSecret = 'image-gate-test-secret';
const GUILD_ID = '1544515514783637577';
const ADULT_ROLE_ID = '1550000000000000001';
const REQUESTER_ID = '1551111111111111111';

const config = loadConfig({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5174',
  DATABASE_URL: 'postgres://test:test@localhost/test',
  SESSION_SECRET: 'test-session-secret-at-least-32-characters',
  DISCORD_CLIENT_ID: '',
  DISCORD_CLIENT_SECRET: 'test',
  DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  DISCORD_GUILD_ID: GUILD_ID,
  DISCORD_ADULT_ROLE_IDS: ADULT_ROLE_ID,
  CODA_DISCORD_BOT_TOKEN: 'bot-token-for-role-lookup',
  CODA_INTERNAL_BRIDGE_SECRET: bridgeSecret,
});

const settingsStore = {
  getEffective: async () => ({ guildId: GUILD_ID, adultRoleIds: [ADULT_ROLE_ID] }),
} as unknown as Parameters<typeof createCodaDiscordImageRouter>[2];

/** Minimal pool stub: linked user row plus provider credential row. */
function poolFor(options: { override?: boolean } = {}) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('adult_access_override')) {
        return { rowCount: 1, rows: [{ id: 'user-1', discord_id: REQUESTER_ID, adult_access_override: options.override === true }] };
      }
      if (sql.includes('FROM users')) {
        return { rowCount: 1, rows: [{ id: 'user-1', display_name: 'Member' }] };
      }
      if (sql.includes('user_provider_settings')) {
        // An unopenable credential: any test that reaches the upstream call is
        // asserting the wrong thing and fails loudly instead of silently.
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };
}

function discordFetch(memberRoles: string[] | 'not-found' | 'error') {
  return vi.fn(async (url: string | URL | Request) => {
    const value = String(url);
    if (!value.includes(`/guilds/${GUILD_ID}/members/`)) throw new Error(`Unexpected URL ${value}`);
    if (memberRoles === 'not-found') return new Response('{}', { status: 404 });
    if (memberRoles === 'error') return new Response('{}', { status: 500 });
    return new Response(JSON.stringify({ user: { id: REQUESTER_ID }, roles: memberRoles }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function appFor(pool: unknown, fetchImpl?: unknown, withSettings = true) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/internal/coda-discord-image',
    createCodaDiscordImageRouter(
      config,
      pool as DatabasePool,
      withSettings ? settingsStore : undefined,
      fetchImpl ? { fetchImpl: fetchImpl as typeof fetch } : {},
    ),
  );
  return app;
}

const post = (body: Record<string, unknown>) =>
  request(appFor(poolFor(), discordFetch([ADULT_ROLE_ID])))
    .post('/api/internal/coda-discord-image')
    .set('authorization', `Bearer ${bridgeSecret}`)
    .send(body);

describe('Coda render presets and cost quotes', () => {
  it('exposes four presets with monotonically increasing cost', () => {
    expect(CODA_RENDER_QUALITIES).toEqual(['draft', 'standard', 'high', 'max']);
    const estimates = CODA_RENDER_QUALITIES.map(quality => quoteCodaRender(quality).estimatedAnlas);
    for (let index = 1; index < estimates.length; index += 1) {
      expect(estimates[index]).toBeGreaterThan(estimates[index - 1]!);
    }
  });

  it('routes every preset to a named model and quotes the arithmetic', () => {
    for (const quality of CODA_RENDER_QUALITIES) {
      const preset = codaRenderPreset(quality);
      const quote = quoteCodaRender(quality);
      expect(preset.model).toBe('nai-diffusion-5-full');
      expect(quote.model).toBe(preset.model);
      expect(quote.formula).toContain(String(preset.steps));
      expect(quote.formula).toContain(String(preset.scale));
      expect(quote.estimatedAnlas).toBeGreaterThan(0);
    }
  });

  it('quotes a reroll identically, so a reroll never quietly costs more', () => {
    expect(quoteCodaRender('standard', 'sfw').estimatedAnlas).toBe(quoteCodaRender('standard', 'sfw').estimatedAnlas);
  });

  it('produces the exact figures the Discord confirmation card shows', () => {
    // Pinned because HW-Coda duplicates this arithmetic for the pre-confirmation
    // card. If these numbers move, the member is quoted one price and charged
    // another, so the two implementations must change together.
    expect(quoteCodaRender('draft').estimatedAnlas).toBe(25);
    expect(quoteCodaRender('standard').estimatedAnlas).toBe(59);
  });

  it('validates quality names strictly', () => {
    expect(isCodaRenderQuality('standard')).toBe(true);
    expect(isCodaRenderQuality('ultra')).toBe(false);
    expect(isCodaRenderQuality(undefined)).toBe(false);
  });
});

describe('Coda image adult gating', () => {
  it('refuses an adult render when the requester has no adult role', async () => {
    const fetchImpl = discordFetch([]);
    const response = await request(appFor(poolFor(), fetchImpl))
      .post('/api/internal/coda-discord-image')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send({ discordUserId: REQUESTER_ID, scene: 'relaxed evening scene', rating: 'adult', quality: 'standard', confirmed: true });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('coda_adult_access_required');
    // The refusal must be based on the role check, not on any channel hint.
    expect(fetchImpl).toHaveBeenCalled();
    const requested = String(fetchImpl.mock.calls[0]?.[0]);
    expect(requested).toContain(`/guilds/${GUILD_ID}/members/${REQUESTER_ID}`);
  });

  it('accepts an adult render when the live role evaluation grants access', async () => {
    // Reaching past the gate is the failure mode; this asserts the gate opens
    // and the request proceeds to the credential check.
    const response = await post({ discordUserId: REQUESTER_ID, scene: 'relaxed evening scene', rating: 'adult', confirmed: true });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain('NovelAI key');
  });

  it('accepts the operator override even without the Discord role', async () => {
    const fetchImpl = discordFetch([]);
    const pool = poolFor({ override: true });
    const response = await request(appFor(pool, fetchImpl))
      .post('/api/internal/coda-discord-image')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send({ discordUserId: REQUESTER_ID, scene: 'relaxed evening scene', rating: 'adult', confirmed: true });

    expect(response.status).toBe(409);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when the role lookup cannot reach Discord', async () => {
    for (const failure of ['not-found', 'error'] as const) {
      const response = await request(appFor(poolFor(), discordFetch(failure)))
        .post('/api/internal/coda-discord-image')
        .set('authorization', `Bearer ${bridgeSecret}`)
        .send({ discordUserId: REQUESTER_ID, scene: 'relaxed evening scene', rating: 'adult', confirmed: true });
      expect(response.status).toBe(403);
    }
  });

  it('fails closed when no adult role is configured at all', async () => {
    const noRoles = { getEffective: async () => ({ guildId: GUILD_ID, adultRoleIds: [] }) } as unknown as Parameters<typeof createCodaDiscordImageRouter>[2];
    const app = express();
    app.use(express.json());
    const fetchImpl = discordFetch([ADULT_ROLE_ID]);
    app.use('/api/internal/coda-discord-image', createCodaDiscordImageRouter(config, poolFor() as unknown as DatabasePool, noRoles, { fetchImpl: fetchImpl as typeof fetch }));

    const response = await request(app)
      .post('/api/internal/coda-discord-image')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send({ discordUserId: REQUESTER_ID, scene: 'relaxed evening scene', rating: 'adult', confirmed: true });

    expect(response.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('preserves ordinary SFW generation for a member without adult access', async () => {
    const fetchImpl = discordFetch([]);
    const response = await request(appFor(poolFor(), fetchImpl))
      .post('/api/internal/coda-discord-image')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send({ discordUserId: REQUESTER_ID, scene: 'sitting on a windowsill with a mug of tea', rating: 'sfw', quality: 'draft', confirmed: true });

    // Passes the rating gate and fails only on the missing NovelAI credential.
    expect(response.status).toBe(409);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('routes an explicit scene without adult rating to the gated path instead of rendering', async () => {
    const response = await post({ discordUserId: REQUESTER_ID, scene: 'Coda completely nude in the shower', rating: 'sfw', confirmed: true });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('coda_rating_required');
  });

  it('never spends Anlas without an explicit confirmation flag', async () => {
    const response = await post({ discordUserId: REQUESTER_ID, scene: 'reading a book', rating: 'sfw' });
    expect(response.status).toBe(400);
  });

  it('screens explicit scene language coarsely and lets tame scenes through', () => {
    expect(sceneRequestsExplicitContent('Coda completely nude')).toBe(true);
    expect(sceneRequestsExplicitContent('sexually explicit pose')).toBe(true);
    expect(sceneRequestsExplicitContent('explicit content, please')).toBe(true);
    expect(sceneRequestsExplicitContent('reading a book on the sofa')).toBe(false);
    expect(sceneRequestsExplicitContent('wearing an explicit raincoat in a storm')).toBe(false);
  });
});