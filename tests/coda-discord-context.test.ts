// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../server/config';
import { createCodaDiscordBridgeRouter } from '../server/coda-discord-bridge';
import type { DatabasePool } from '../server/db';

const bridgeSecret = 'context-test-secret-that-never-enters-the-prompt';
const config = loadConfig({
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5174',
  DATABASE_URL: 'postgres://test:test@localhost/test',
  SESSION_SECRET: 'test-session-secret-at-least-32-characters',
  DISCORD_CLIENT_ID: '',
  DISCORD_CLIENT_SECRET: 'test',
  DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  CODA_INTERNAL_BRIDGE_SECRET: bridgeSecret,
  CODA_DISCORD_GUEST_ACCESS: 'true',
});

function appFor(query: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/coda-discord', createCodaDiscordBridgeRouter(config, { query } as unknown as DatabasePool));
  return app;
}

const body = {
  discordUserId: '12345678901234567',
  text: 'Coda, what do you remember about our release plan?',
  trigger: 'name',
  speakerName: 'Member',
  guildId: '22345678901234567',
  guildName: 'Howling Whispers',
  channelId: '32345678901234567',
  channelName: 'project-chat',
  recentMessages: [],
};

describe('Coda Discord context bridge', () => {
  it('returns canonical Coda context and only explicitly model-safe memories', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM users')) return { rowCount: 1, rows: [{ id: 'linked-user' }] };
      if (sql.includes('coda_surveillance_memories')) {
        expect(sql).toContain(`tags @> '["coda-context"]'::jsonb`);
        return {
          rowCount: 1,
          rows: [{ scope: 'channel', title: 'Release convention', content: 'Release notes are reviewed before deployment.' }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await request(appFor(query))
      .post('/api/internal/coda-discord/context')
      .set('authorization', `Bearer ${bridgeSecret}`)
      .send(body)
      .expect(200);

    expect(response.body.prompt).toContain('CODA DISCORD MODE');
    expect(response.body.prompt).toContain('Release convention');
    expect(response.body.prompt).toContain('Release notes are reviewed before deployment.');
    expect(response.body.prompt).not.toContain(bridgeSecret);
    expect(response.body).not.toHaveProperty('credential');
    expect(response.body).not.toHaveProperty('token');
  });

  it('requires the internal bridge credential', async () => {
    const query = vi.fn();
    await request(appFor(query)).post('/api/internal/coda-discord/context').send(body).expect(401);
    expect(query).not.toHaveBeenCalled();
  });
});
