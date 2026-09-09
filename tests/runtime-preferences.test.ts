import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { DatabasePool } from '../server/db';
import { createRuntimePreferencesRouter } from '../server/runtime-preferences';

const userId = '11111111-1111-4111-8111-111111111111';

function appWith(pool: DatabasePool) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'session', { value: { userId }, configurable: true });
    next();
  });
  app.use('/api/runtime-preferences', createRuntimePreferencesRouter(pool));
  return app;
}

describe('Speculus runtime preferences', () => {
  it('loads the account defaults used by Speculus', async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 1, rows: [{ player_pronouns: null, response_length_mode: 'adaptive' }] })) } as unknown as DatabasePool;
    const response = await request(appWith(pool)).get('/api/runtime-preferences').expect(200);
    expect(response.body).toEqual({ pronouns: null, responseLength: 'adaptive' });
  });

  it('saves explicit pronouns and response length', async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 1, rows: [{ player_pronouns: 'she/her', response_length_mode: 'normal' }] })) } as unknown as DatabasePool;
    const response = await request(appWith(pool)).patch('/api/runtime-preferences')
      .send({ pronouns: 'she/her', responseLength: 'normal' })
      .expect(200);
    expect(response.body).toEqual({ pronouns: 'she/her', responseLength: 'normal' });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), [userId, 'she/her', 'normal']);
  });

  it('allows pronouns to remain unset and rejects invented values', async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 1, rows: [{ player_pronouns: null, response_length_mode: 'concise' }] })) } as unknown as DatabasePool;
    await request(appWith(pool)).patch('/api/runtime-preferences').send({ pronouns: null, responseLength: 'concise' }).expect(200);
    await request(appWith(pool)).patch('/api/runtime-preferences').send({ pronouns: 'whatever/model-guesses', responseLength: 'concise' }).expect(500);
  });
});
