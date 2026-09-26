import { describe, expect, it } from 'vitest';
import { listCodaLogUsers, listCodaLogs, recordCodaLog, type CodaLogEntry } from '../server/coda-log';
import type { DatabasePool } from '../server/db';

const userId = '44444444-4444-4444-8444-444444444444';

function logPool() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT l.id')) {
        return { rows: [{
          id: 7, user_id: userId, user_display_name: 'David Silver', request_id: 'req-1', channel: 'assistant',
          mode: 'sort', model: 'xialong-v1', page_hint: 'Record editor', asset_id: null, asset_name: 'Eirvargr\'s World',
          intent: 'apply', apply_operations: true, operation_count: 1, saved_count: 0, failed_count: 1, status: 'refused',
          duration_ms: 1234, input_chars: 500, operations: [{ op: 'create' }], write_results: [{ status: 'failed' }],
          record_patch: null, message: 'Nothing was saved', created_at: new Date('2026-09-26T12:00:00Z'),
        }], rowCount: 1 };
      }
      if (sql.includes('GROUP BY l.user_id')) {
        return { rows: [{ user_id: userId, display_name: 'David Silver', entries: 3, last_seen: new Date('2026-09-26T12:00:00Z') }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as DatabasePool;
  return { pool, queries };
}

const entry: CodaLogEntry = {
  requestId: 'req-1', channel: 'assistant', mode: 'sort', model: 'xialong-v1', intent: 'apply',
  applyOperations: true, operationCount: 1, savedCount: 0, failedCount: 1, status: 'refused',
  durationMs: 42, inputChars: 120, operations: [{ op: 'create', name: 'A' }], writeResults: [],
  message: 'Nothing was saved for "A": Only the world owner can add records to this world.',
};

describe('Coda per-user debugging log', () => {
  it('stores a log row tied to the requesting user', async () => {
    const { pool, queries } = logPool();
    await recordCodaLog(pool, userId, entry);
    const insert = queries.find((query) => query.sql.includes('INSERT INTO coda_request_logs'));
    expect(insert?.params?.[0]).toBe(userId);
    expect(insert?.params?.[1]).toBe('req-1');
    expect(insert?.params?.[13]).toBe('refused');
  });

  it('never lets a logging failure break the request', async () => {
    const pool = { query: async () => { throw new Error('log table missing'); } } as unknown as DatabasePool;
    await expect(recordCodaLog(pool, userId, entry)).resolves.toBeUndefined();
  });

  it('reads logs back per user with the write outcome attached', async () => {
    const { pool, queries } = logPool();
    const items = await listCodaLogs(pool, { userId });
    expect(queries[0].params?.[1]).toBe(userId);
    expect(items[0]).toMatchObject({ userId, status: 'refused', savedCount: 0, failedCount: 1, userDisplayName: 'David Silver' });
    expect(items[0].message).toBe('Nothing was saved');
  });

  it('lists which users have Coda activity', async () => {
    const { pool } = logPool();
    const users = await listCodaLogUsers(pool);
    expect(users[0]).toMatchObject({ userId, displayName: 'David Silver', entries: 3 });
  });
});
