import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { DatabasePool } from '../server/db';
import { createSimulationSettingsRouter, readSimulationSettings } from '../server/simulation-settings';

const userId = '11111111-1111-4111-8111-111111111111';
function appFor(pool: DatabasePool, signedIn = true) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { Object.defineProperty(req, 'session', { value: signedIn ? { userId } : {} }); next(); });
  app.use('/api/simulation-settings', createSimulationSettingsRouter(pool));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof ZodError ? 400 : 500).json({ error: 'Invalid settings' }));
  return app;
}
describe('account simulation preferences', () => {
  it('defaults an account with no saved preference to V1', async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 0, rows: [] })) } as unknown as DatabasePool;
    expect(await readSimulationSettings(pool, userId)).toEqual({ engine: 'v1', available: true });
  });
  it('keeps V1 available before migration but refuses to pretend a choice was saved', async () => {
    const pool = { query: vi.fn(async () => { throw { code: '42P01' }; }) } as unknown as DatabasePool;
    expect(await readSimulationSettings(pool, userId)).toEqual({ engine: 'v1', available: false });
    await request(appFor(pool)).put('/api/simulation-settings').send({ engine: 'v2' }).expect(503);
  });
  it('saves and reloads the preference using authenticated ownership, independent of a provider token', async () => {
    let saved = 'v1'; const query = vi.fn(async (sql: string, values: unknown[]) => {
      expect(values[0]).toBe(userId);
      if (sql.startsWith('INSERT')) saved = String(values[1]);
      return { rowCount: 1, rows: [{ engine: saved }] };
    });
    const app = appFor({ query } as unknown as DatabasePool);
    await request(app).put('/api/simulation-settings').send({ engine: 'v2' }).expect(200);
    const response = await request(app).get('/api/simulation-settings').expect(200);
    expect(response.body).toEqual({ engine: 'v2', available: true });
    await request(app).put('/api/simulation-settings').send({ engine: 'v1' }).expect(200);
    expect(saved).toBe('v1');
  });
  it('rejects unknown engines, URLs and caller-supplied ownership without a write', async () => {
    const query = vi.fn(); const app = appFor({ query } as unknown as DatabasePool);
    for (const body of [{ engine: 'dev' }, { engine: 'https://example.com' }, { engine: 'v2', userId: 'someone-else' }]) {
      await request(app).put('/api/simulation-settings').send(body).expect(400);
    }
    expect(query).not.toHaveBeenCalled();
  });
  it('requires authentication for reads and writes', async () => {
    const query = vi.fn(); const app = appFor({ query } as unknown as DatabasePool, false);
    await request(app).get('/api/simulation-settings').expect(401);
    await request(app).put('/api/simulation-settings').send({ engine: 'v2' }).expect(401);
    expect(query).not.toHaveBeenCalled();
  });
  it('does not hide a database outage as a user preference', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('offline'); }) } as unknown as DatabasePool;
    await expect(readSimulationSettings(pool, userId)).rejects.toThrow('offline');
  });
});
