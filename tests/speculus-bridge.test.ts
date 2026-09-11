import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';
import { credentialKey, openCredential, sealCredential } from '../server/provider-settings';
import type { SettingsStore } from '../server/settings';
import { createSpeculusGenerationRouter, createSpeculusLaunchRouter } from '../server/speculus';

const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const userId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';
const updatedAt = '2026-09-07T20:00:00.000Z';
const config = loadConfig({
  NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test',
  SESSION_SECRET: 'speculus-bridge-test-secret-long-enough', DISCORD_CLIENT_ID: 'client',
  DISCORD_CLIENT_SECRET: 'secret', DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  ORBIS_CREDENTIAL_ENCRYPTION_KEY: encryptionKey, SPECULUS_BRIDGE_URL: 'http://127.0.0.1:8790',
  SPECULUS_BRIDGE_SECRET: 'shared-test-bridge-secret',
});
const settingsStore = { getEffective: async () => ({}) } as SettingsStore;

function withSession(app: express.Express) {
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'session', { value: {
      userId, discordUserId: '999999999999999999',
      access: { isGuildMember: true, canViewAdult: true, canCreate: false, canAdmin: false, checkedAt: Date.now() },
    }, configurable: true });
    next();
  });
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Speculus security bridge', () => {
  it('encrypts provider credentials with authenticated encryption', () => {
    const key = credentialKey(encryptionKey);
    const sealed = sealCredential('novelai-secret-token', key);
    expect(sealed.ciphertext.toString()).not.toContain('novelai-secret-token');
    expect(openCredential(sealed, key)).toBe('novelai-secret-token');
    expect(() => openCredential(sealed, Buffer.alloc(32, 8))).toThrow();
  });

  it('boxes an Orbis record and deposits only an opaque grant in Speculus', async () => {
    const captured: { body?: Record<string, unknown>; authorization?: string } = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured.body = JSON.parse(String(init?.body));
      captured.authorization = new Headers(init?.headers).get('authorization') ?? undefined;
      return new Response(JSON.stringify({ launchUrl: 'https://spec.thehowlingwhispers.com/?launch=once' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }));
    const pool = { query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM library_assets a') && sql.includes('WHERE a.id')) return { rowCount: 1, rows: [{
        id: assetId, type: 'character', name: 'Ragna Holt', summary: 'A boundary warden.',
        creator_user_id: userId, content_rating: 'adult', origin_world_id: null, updated_at: updatedAt,
        tags: ['Werewolf'], document: { description: 'Terse and observant.', personality: 'Protective' },
      }] };
      if (sql.includes('SELECT model FROM user_provider_settings')) return { rowCount: 1, rows: [{ model: 'xialong-v1' }] };
      if (sql.includes('SELECT id, display_name FROM users')) return { rowCount: 1, rows: [{ id: userId, display_name: 'Eirvargr' }] };
      if (sql.includes('id <> $1')) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM ensure_speculus_catalog_entry_v2')) return { rowCount: 1, rows: [{
        code: 'SPC-C-KD41827', prefix: 'C', plate: 'KD41827', generation: 1,
        registry_number: 1, class_registry_number: 1, classification: 'character',
        asset_created_at: updatedAt, status: 'active',
      }] };
      if (sql.includes('INSERT INTO generation_grants')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    }) } as unknown as DatabasePool;
    const app = express(); app.use(express.json()); withSession(app);
    app.use('/api/v1/library', createSpeculusLaunchRouter(config, pool, settingsStore));

    const response = await request(app).post(`/api/v1/library/assets/${assetId}/simulate`).expect(201);
    expect(response.body.launchUrl).toContain('spec.thehowlingwhispers.com');
    expect(captured.authorization).toBe('Bearer shared-test-bridge-secret');
    expect(captured.body).toMatchObject({
      version: 1, model: 'xialong-v1',
      primaryAsset: { id: assetId, type: 'character', revision: updatedAt },
      catalog: { code: 'SPC-C-KD41827', classification: 'character' },
      persona: { name: 'Eirvargr' },
      character: { name: 'Ragna Holt', description: 'Terse and observant.' },
    });
    expect(String(captured.body?.generationGrant)).toHaveLength(43);
    expect(JSON.stringify(captured.body)).not.toContain('novelai-secret-token');
  });

  it('uses the saved token only inside Orbis when redeeming a scoped grant', async () => {
    const sealed = sealCredential('novelai-secret-token', credentialKey(encryptionKey));
    let upstreamAuthorization = '';
    let upstreamBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      upstreamAuthorization = new Headers(init?.headers).get('authorization') ?? '';
      upstreamBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ text: 'The warden answers.', finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': 'nai-1' } });
    }));
    const launchId = '33333333-3333-4333-8333-333333333333';
    const pool = { query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM generation_grants')) return { rowCount: 1, rows: [{
        launch_id: launchId, asset_id: assetId, asset_type: 'character', asset_revision: updatedAt, model: 'xialong-v1',
        token_ciphertext: sealed.ciphertext, token_iv: sealed.iv, token_tag: sealed.tag,
      }] };
      if (sql.startsWith('UPDATE generation_grants')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    }) } as unknown as DatabasePool;
    const app = express(); app.use(express.json()); app.use('/api/v1/generation', createSpeculusGenerationRouter(config, pool));
    const response = await request(app).post('/api/v1/generation/speculus')
      .set('Authorization', 'Bearer opaque-speculus-generation-grant')
      .send({
        launchId, source: { id: assetId, revision: updatedAt, type: 'character' }, prompt: 'Continue.',
        model: 'xialong-v1', temperature: 0.85, maxTokens: 256, topK: 250, topP: 0.95,
        presencePenalty: 0.2, frequencyPenalty: 0.3, stopSequences: ['PLAYER:'],
        continueToEndOfSentence: true, reroll: false,
      })
      .expect(200);
    expect(upstreamAuthorization).toBe('Bearer novelai-secret-token');
    expect(upstreamBody).toMatchObject({
      max_tokens: 256, temperature: 0.85, top_k: 250, top_p: 0.95,
      presence_penalty: 0.2, frequency_penalty: 0.3, stream: false,
    });
    expect(upstreamBody.prompt).toContain('Complete the final sentence within the output allowance.');
    expect(upstreamBody.stop).toContain('PLAYER:');
    expect(response.body).toEqual({ text: 'The warden answers.', finishReason: 'stop' });
    expect(JSON.stringify(response.body)).not.toContain('novelai-secret-token');
    expect(response.headers['x-request-id']).toBe('nai-1');
  });
});
