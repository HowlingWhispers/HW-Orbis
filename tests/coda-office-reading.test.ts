// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  buildOfficeReadingReference,
  chunkOfficeDocument,
  createCodaOfficeReadingRouter,
  processOfficeReadingJobs,
  readOfficeDocument,
} from '../server/coda-office-reading';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';

const secret = 'office-reading-test-secret';
const config = loadConfig({
  NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test',
  SESSION_SECRET: 'test-session-secret-at-least-32-characters', DISCORD_CLIENT_ID: '',
  DISCORD_CLIENT_SECRET: 'test', DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  CODA_INTERNAL_BRIDGE_SECRET: secret,
});

function appFor(query: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api/internal/orbis-office-reading', createCodaOfficeReadingRouter(config, { query } as unknown as DatabasePool));
  return app;
}

const enqueueBody = {
  requestId: '11111111-1111-4111-8111-111111111111',
  discordUserId: '12345678901234567',
  guildId: '22345678901234567',
  channelId: '32345678901234567',
  messageId: '42345678901234567',
  attachmentName: 'large.md',
  attachmentHash: 'a'.repeat(64),
  contentType: 'text/markdown',
  sizeBytes: 80_000,
  sourceText: '# One\n\nFirst section.\n\n# Two\n\nSecond section.',
};

describe('Coda office reading', () => {
  it('chunks and indexes the complete document rather than truncating it', () => {
    const source = Array.from({ length: 40 }, (_, index) => `# Section ${index}\n\nMarker-${index} ${'text '.repeat(300)}`).join('\n\n');
    const chunks = chunkOfficeDocument(source, 1_000);
    const result = readOfficeDocument(source);

    expect(chunks.length).toBeGreaterThan(40);
    for (let index = 0; index < 40; index += 1) {
      expect(chunks.some(chunk => chunk.text.includes(`Marker-${index}`))).toBe(true);
    }
    expect(result.notes.length).toBe(result.chunks.length);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('requires bridge authentication and idempotently accepts a durable job', async () => {
    const query = vi.fn(async (sql: string, values: unknown[]) => {
      expect(sql).toContain('ON CONFLICT (message_id, attachment_hash)');
      expect(values[9]).toBe(enqueueBody.sourceText);
      return { rowCount: 1, rows: [{ id: '51111111-1111-4111-8111-111111111111', status: 'queued' }] };
    });
    await request(appFor(query)).post('/api/internal/orbis-office-reading/jobs').send(enqueueBody).expect(401);
    const response = await request(appFor(query)).post('/api/internal/orbis-office-reading/jobs')
      .set('authorization', `Bearer ${secret}`).send(enqueueBody).expect(202);
    expect(response.body).toEqual({ jobId: '51111111-1111-4111-8111-111111111111', status: 'queued' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns the same job when Discord delivers one attachment event twice', async () => {
    const query = vi.fn(async (_sql: string) => ({
      rowCount: 1,
      rows: [{ id: '51111111-1111-4111-8111-111111111111', status: 'queued' }],
    }));
    const app = appFor(query);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request(app).post('/api/internal/orbis-office-reading/jobs')
        .set('authorization', `Bearer ${secret}`).send({ ...enqueueBody, requestId: `${attempt + 1}1111111-1111-4111-8111-111111111111` }).expect(202);
      expect(response.body.jobId).toBe('51111111-1111-4111-8111-111111111111');
    }
    expect(query.mock.calls.every(([sql]) => String(sql).includes('ON CONFLICT (message_id, attachment_hash)'))).toBe(true);
  });

  it('lists office state only for the requesting Discord user and current channel', async () => {
    const query = vi.fn(async (_sql: string, values: unknown[]) => {
      expect(values).toEqual(['12345678901234567', '32345678901234567']);
      return { rowCount: 1, rows: [{ jobId: 'job-1', attachmentName: 'private.md', status: 'ready' }] };
    });
    const response = await request(appFor(query)).get('/api/internal/orbis-office-reading/jobs')
      .query({ discordUserId: '12345678901234567', channelId: '32345678901234567' })
      .set('authorization', `Bearer ${secret}`).expect(200);
    expect(response.body.jobs).toHaveLength(1);
  });

  it('claims with a lease and persists ready chunks, notes, and summary', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('RETURNING id::text, source_text')) {
        return { rowCount: 1, rows: [{ id: 'job-1', source_text: enqueueBody.sourceText }] };
      }
      return { rowCount: 1, rows: [] };
    });
    expect(await processOfficeReadingJobs({ query } as unknown as DatabasePool)).toEqual({ processed: 1 });
    expect(calls[0]?.sql).toContain("status = 'reading' AND lease_expires_at < NOW()");
    expect(calls.some(call => call.sql.includes('FOR UPDATE SKIP LOCKED'))).toBe(true);
    const completion = calls.find(call => call.sql.includes("status = 'ready'"));
    expect(JSON.parse(String(completion?.values?.[1]))).not.toHaveLength(0);
    expect(JSON.parse(String(completion?.values?.[2]))).not.toHaveLength(0);
    expect(String(completion?.values?.[3])).toContain('First section');
  });

  it('retrieves the relevant source without crossing user scope or blending unrelated documents', async () => {
    const query = vi.fn(async (_sql: string, values: unknown[]) => {
      expect(values).toEqual(['12345678901234567', '32345678901234567']);
      return {
      rowCount: 1,
      rows: [
        { attachment_name: 'lore.md', summary: 'Unrelated lore.', chunks: [{ index: 0, start: 0, end: 20, text: 'Bacon storage procedure.' }] },
        { attachment_name: 'manual.md', summary: 'A manual.', chunks: [{ index: 0, start: 0, end: 60, text: 'Provider retry and timeout guidance.' }] },
      ],
    };
    });
    const reference = await buildOfficeReadingReference(
      { query } as unknown as DatabasePool,
      '12345678901234567', '32345678901234567', 'What is the provider retry guidance?',
    );
    expect(reference).toContain('Provider retry and timeout guidance.');
    expect(reference).toContain('manual.md');
    expect(reference).not.toContain('lore.md');
  });
});
