import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { DatabasePool } from '../server/db';
import { createWorldBrainRouter } from '../server/world-brain';

const worldId = '22222222-2222-4222-8222-222222222222';
const userId = '11111111-1111-4111-8111-111111111111';
const revisionId = '33333333-3333-4333-8333-333333333333';

function appFor(pool: DatabasePool) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'session', { value: { userId, discordUserId: '999999999999999999' } });
    next();
  });
  app.use('/api/v1/library', createWorldBrainRouter(pool));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
    res.status(error instanceof ZodError ? 400 : 500).json({ error: 'Invalid request' }));
  return app;
}

describe('World Brain revisions', () => {
  it('loads standard fallback with immutable custom history', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id, type')) return { rowCount: 1, rows: [{ id: worldId, type: 'world', creator_user_id: userId }] };
      if (sql.includes('FROM world_brain_bindings')) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM world_brain_revisions')) return { rowCount: 1, rows: [{
        id: revisionId, kind: 'custom', revision_number: 1, source: 'ONE WORLD BRAIN', notes: 'first',
        created_at: '2026-09-18T10:00:00.000Z', published_at: '2026-09-18T10:00:00.000Z',
      }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const response = await request(appFor({ query } as unknown as DatabasePool))
      .get(`/api/v1/library/assets/${worldId}/world-brain`).expect(200);
    expect(response.body.mode).toBe('standard');
    expect(response.body.selectedRevisionId).toBeNull();
    expect(response.body.revisions[0]).toMatchObject({ id: revisionId, revisionNumber: 1, source: 'ONE WORLD BRAIN' });
  });

  it('publishes a new immutable custom revision and makes it effective', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id, type')) return { rowCount: 1, rows: [{ id: worldId, type: 'world', creator_user_id: userId }] };
      if (sql.includes('INSERT INTO world_brain_revisions')) return { rowCount: 1, rows: [{
        id: revisionId, kind: 'custom', revision_number: 2, source: 'UPDATED BRAIN', notes: 'revision two',
        created_at: '2026-09-18T11:00:00.000Z', published_at: '2026-09-18T11:00:00.000Z',
      }] };
      if (sql.includes('INSERT INTO world_brain_bindings')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const response = await request(appFor({ query } as unknown as DatabasePool))
      .post(`/api/v1/library/assets/${worldId}/world-brain/revisions`)
      .send({ source: 'UPDATED BRAIN', notes: 'revision two' })
      .expect(201);
    expect(response.body).toMatchObject({ mode: 'custom', revision: { revisionNumber: 2, source: 'UPDATED BRAIN' } });
  });

  it('refuses to bind another worlds revision', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id, type')) return { rowCount: 1, rows: [{ id: worldId, type: 'world', creator_user_id: userId }] };
      if (sql.includes('SELECT id FROM world_brain_revisions')) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    await request(appFor({ query } as unknown as DatabasePool))
      .put(`/api/v1/library/assets/${worldId}/world-brain/binding`)
      .send({ mode: 'custom', revisionId })
      .expect(400);
  });
});
