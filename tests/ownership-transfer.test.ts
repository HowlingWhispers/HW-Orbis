import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { DatabasePool } from '../server/db';
import { createOwnershipTransferRouter } from '../server/ownership-transfer';

const worldId = '22222222-2222-4222-8222-222222222222';
const ownerId = '11111111-1111-4111-8111-111111111111';
const targetId = '33333333-3333-4333-8333-333333333333';

function appFor(pool: DatabasePool) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'session', { value: { userId: ownerId, discordUserId: '999999999999999999' } });
    next();
  });
  app.use('/api/v1/library', createOwnershipTransferRouter(pool));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({ error: 'Invalid request.' });
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected error.' });
  });
  return app;
}

describe('world ownership transfer', () => {
  it('searches only transfer-eligible creator accounts', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT id, type, name')) {
        return { rowCount: 1, rows: [{ id: worldId, type: 'world', name: 'Everglow', creator_user_id: ownerId }] };
      }
      if (sql.includes('FROM users')) {
        expect(sql).toContain('can_create = true');
        return { rowCount: 1, rows: [{
          id: targetId,
          discord_id: '127264601216647168',
          discord_username: 'davidsilver',
          display_name: 'David Silver',
          avatar_url: null,
        }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await request(appFor({ query } as unknown as DatabasePool))
      .get(`/api/v1/library/assets/${worldId}/transfer-targets?search=David`)
      .expect(200);

    expect(response.body.items).toEqual([{
      id: targetId,
      discordId: '127264601216647168',
      discordUsername: 'davidsilver',
      displayName: 'David Silver',
    }]);
  });

  it('moves current control for the world and every owned child in one transaction', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.includes('FROM library_assets WHERE id = $1 FOR UPDATE')) {
        return { rowCount: 1, rows: [{ id: worldId, type: 'world', name: 'Everglow', creator_user_id: ownerId }] };
      }
      if (sql.includes('FROM users WHERE id = $1 FOR SHARE')) {
        return { rowCount: 1, rows: [{
          id: targetId,
          discord_id: '127264601216647168',
          discord_username: 'davidsilver',
          display_name: 'David Silver',
          avatar_url: null,
          can_create: true,
        }] };
      }
      if (sql.includes('foreign_count')) return { rowCount: 1, rows: [{ child_count: 169, foreign_count: 0 }] };
      if (sql.includes('UPDATE library_assets')) {
        expect(params).toEqual([worldId, targetId]);
        return { rowCount: 170, rows: [] };
      }
      if (sql.includes('INSERT INTO library_world_ownership_transfers')) {
        expect(params).toEqual([worldId, 'Everglow', ownerId, targetId, ownerId, 169]);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release }));

    const response = await request(appFor({ connect } as unknown as DatabasePool))
      .post(`/api/v1/library/assets/${worldId}/transfer`)
      .send({ targetUserId: targetId, confirmName: 'Everglow' })
      .expect(200);

    expect(response.body).toMatchObject({
      worldId,
      worldName: 'Everglow',
      childCount: 169,
      transferredTo: { id: targetId, displayName: 'David Silver' },
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE library_assets'))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back instead of taking a child owned by somebody else', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.includes('FROM library_assets WHERE id = $1 FOR UPDATE')) {
        return { rowCount: 1, rows: [{ id: worldId, type: 'world', name: 'Everglow', creator_user_id: ownerId }] };
      }
      if (sql.includes('FROM users WHERE id = $1 FOR SHARE')) {
        return { rowCount: 1, rows: [{
          id: targetId,
          discord_id: '127264601216647168',
          discord_username: 'davidsilver',
          display_name: 'David Silver',
          avatar_url: null,
          can_create: true,
        }] };
      }
      if (sql.includes('foreign_count')) return { rowCount: 1, rows: [{ child_count: 169, foreign_count: 1 }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release }));

    const response = await request(appFor({ connect } as unknown as DatabasePool))
      .post(`/api/v1/library/assets/${worldId}/transfer`)
      .send({ targetUserId: targetId, confirmName: 'Everglow' })
      .expect(409);

    expect(response.body.error).toContain('owned by another account');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE library_assets'))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
