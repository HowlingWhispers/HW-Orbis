import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';
import { credentialKey, sealCredential } from '../server/provider-settings';
import { createSpeculusGenerationRouter } from '../server/speculus';

const token = 'test-only-private-provider-token';
const grant = 'test-only-private-generation-grant';
const prompt = 'Private fictional scene that must not appear in errors.';
const encryptionKey = Buffer.alloc(32, 4).toString('base64');
const config = loadConfig({
  NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test',
  SESSION_SECRET: 'generation-errors-test-secret-long-enough', DISCORD_CLIENT_ID: 'client',
  DISCORD_CLIENT_SECRET: 'secret', DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  ORBIS_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
});
const body = {
  launchId: '33333333-3333-4333-8333-333333333333',
  source: { id: '22222222-2222-4222-8222-222222222222', revision: 'test-revision', type: 'place' },
  prompt, model: 'xialong-v1', temperature: 0.85, maxTokens: 512,
};
function fixture() {
  const sealed = sealCredential(token, credentialKey(encryptionKey));
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM generation_grants')) return { rowCount: 1, rows: [{
      launch_id: body.launchId, asset_id: body.source.id, asset_type: body.source.type,
      asset_revision: body.source.revision, model: body.model,
      token_ciphertext: sealed.ciphertext, token_iv: sealed.iv, token_tag: sealed.tag,
    }] };
    if (sql.includes('UPDATE generation_grants SET use_count')) return { rowCount: 1, rows: [] };
    throw new Error('Unexpected database query.');
  });
  const app = express(); app.use(express.json());
  app.use('/api/v1/generation', createSpeculusGenerationRouter(config, { query } as unknown as DatabasePool));
  return { query, send: () => request(app).post('/api/v1/generation/speculus').set('Authorization', `Bearer ${grant}`).send(body) };
}
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('actionable, private Speculus generation errors', () => {
  it.each([
    [401, 'NOVELAI_AUTH_FAILED'], [403, 'NOVELAI_ACCESS_DENIED'],
    [404, 'NOVELAI_MODEL_UNAVAILABLE'], [429, 'NOVELAI_RATE_LIMITED'],
    [400, 'NOVELAI_INVALID_REQUEST'], [422, 'NOVELAI_INVALID_REQUEST'],
    [503, 'NOVELAI_UNAVAILABLE'],
  ])('preserves the category and provider HTTP %s without exposing provider content', async (status, code) => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({ error: { message: `${token} ${grant} ${prompt}`, param: 'max_tokens' } }), { status: Number(status) }));
    vi.stubGlobal('fetch', upstream);
    const { query, send } = fixture();
    const response = await send().expect(502);
    expect(response.body).toMatchObject({ code, upstreamStatus: status, requestedMaxTokens: 512, parameter: 'max_tokens' });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(response.body.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers['cache-control']).toBe('no-store');
    const exposed = JSON.stringify([response.body, vi.mocked(console.warn).mock.calls]);
    for (const secret of [token, grant, prompt]) expect(exposed).not.toContain(secret);
    expect(query).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each(['stop', 'length'])('distinguishes a successful but empty response with finish reason %s', async (finishReason) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ text: ' ', finish_reason: finishReason }] }))));
    const response = await fixture().send().expect(502);
    expect(response.body).toMatchObject({ code: 'NOVELAI_EMPTY_REPLY', upstreamStatus: 200, finishReason, requestedMaxTokens: 512 });
  });

  it('uses parsedContent when NovelAI returns a blank raw text field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ text: ' ', parsedContent: '*A usable short reply.*', finish_reason: 'stop' }] }))));
    const response = await fixture().send().expect(200);
    expect(response.body).toMatchObject({ text: '*A usable short reply.*', finishReason: 'stop' });
    expect(response.body.text).not.toContain(token);
    expect(response.body.text).not.toContain(prompt);
  });

  it.each([[502, 'NOVELAI_UNAVAILABLE'], [200, 'NOVELAI_INVALID_RESPONSE']])('handles non-JSON provider HTTP %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<html>${token} ${prompt}</html>`, { status: Number(status) })));
    const response = await fixture().send().expect(502);
    expect(response.body).toMatchObject({ code, upstreamStatus: status });
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(JSON.stringify(response.body)).not.toContain(prompt);
  });

  it('reports connection failure without logging the thrown request or retrying it', async () => {
    const upstream = vi.fn(async () => { throw new Error(`${token} ${prompt}`); });
    vi.stubGlobal('fetch', upstream);
    const response = await fixture().send().expect(502);
    expect(response.body.code).toBe('NOVELAI_NETWORK_FAILURE');
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(token);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('reports an upstream timeout as 504 and makes only one attempt', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((...args: Parameters<typeof setTimeout>) => {
      const [callback, delay, ...callbackArgs] = args;
      return originalSetTimeout(callback, delay === 180_000 ? 0 : delay, ...callbackArgs);
    }) as typeof setTimeout);
    const upstream = vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    vi.stubGlobal('fetch', upstream);
    const response = await fixture().send().expect(504);
    expect(response.body.code).toBe('NOVELAI_TIMEOUT');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('accepts only known parameter names from structured validation errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: [
      { loc: ['body', token], input: prompt }, { loc: ['body', 'top_p'], input: prompt },
    ] }), { status: 422 })));
    const response = await fixture().send().expect(502);
    expect(response.body.parameter).toBe('top_p');
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(JSON.stringify(response.body)).not.toContain(prompt);
  });
});
