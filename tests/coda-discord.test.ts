import { describe, expect, it, vi } from 'vitest';
import { listCodaDiscordChannels, sendCodaDiscordMessage } from '../server/coda-discord';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';

const ids = {
  guild: '1544909655275208716',
  general: '111111111111111111',
  admin: '222222222222222222',
  blocked: '333333333333333333',
  message: '444444444444444444',
  user: '00000000-0000-4000-8000-000000000001',
};

const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '8789',
  APP_ORIGIN: 'http://localhost:5174',
  DATABASE_URL: 'postgres://test',
  SESSION_SECRET: 'session-secret-value-that-is-long-enough',
  SESSION_COOKIE_NAME: 'orbis.sid',
  TRUST_PROXY: 'false',
  DISCORD_CLIENT_ID: 'client-id',
  DISCORD_CLIENT_SECRET: 'discord-secret',
  DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  DISCORD_GUILD_ID: ids.guild,
  CODA_DISCORD_BOT_TOKEN: 'coda-bot-token',
  CODA_DISCORD_CHANNEL_IDS: ids.general + ',' + ids.admin,
  DISCORD_ADULT_ROLE_IDS: '',
  DISCORD_CREATOR_ROLE_IDS: '',
  DISCORD_ADMIN_ROLE_IDS: '',
  DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS: '',
  DISCORD_INVITE_URL: '',
  VITE_DISCORD_INVITE_URL: '',
});

describe('Coda Discord admin sender', () => {
  it('only exposes allowlisted text-capable channels', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([
      { id: ids.general, type: 0, name: 'general', position: 2 },
      { id: ids.admin, type: 5, name: 'announcements', position: 1 },
      { id: ids.blocked, type: 0, name: 'blocked', position: 0 },
      { id: '555555555555555555', type: 2, name: 'voice', position: 0 },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await listCodaDiscordChannels(config, ids.guild, fetchImpl);
    expect(result.configured).toBe(true);
    expect(result.items.map((channel) => channel.id)).toEqual([ids.admin, ids.general]);
  });

  it('posts through the bot token and records the administrative send', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/guilds/' + ids.guild + '/channels')) {
        return new Response(JSON.stringify([{ id: ids.general, type: 0, name: 'general', position: 0 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ id: ids.message }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [{ id: '17', created_at: new Date('2026-09-26T00:00:00Z') }], rowCount: 1 };
      },
    } as unknown as DatabasePool;

    const result = await sendCodaDiscordMessage(config, pool, ids.guild, ids.user, { channelId: ids.general, content: 'Hello from Coda!', replyTo: '' }, fetchImpl);
    expect(result.message.discordMessageId).toBe(ids.message);
    const post = calls.find((call) => call.url.endsWith('/channels/' + ids.general + '/messages'));
    expect(post?.init?.headers).toMatchObject({ Authorization: 'Bot coda-bot-token' });
    expect(JSON.parse(String(post?.init?.body)).content).toBe('Hello from Coda!');
    expect(queries.some((query) => query.sql.includes('INSERT INTO coda_discord_messages'))).toBe(true);
  });

  it('rejects a destination outside the server allowlist before posting', async () => {
    const fetchImpl = vi.fn();
    const pool = { query: vi.fn() } as unknown as DatabasePool;
    await expect(sendCodaDiscordMessage(config, pool, ids.guild, ids.user, { channelId: ids.blocked, content: 'Nope', replyTo: '' }, fetchImpl)).rejects.toThrow('allowlist');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts a Discord message link only when it belongs to the selected channel', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/guilds/' + ids.guild + '/channels')) {
        return new Response(JSON.stringify([{ id: ids.general, type: 0, name: 'general', position: 0 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ id: ids.message }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const pool = { query: async () => ({ rows: [{ id: '18', created_at: new Date() }], rowCount: 1 }) } as unknown as DatabasePool;
    const wrongChannelLink = 'https://discord.com/channels/' + ids.guild + '/' + ids.admin + '/' + ids.message;
    await expect(sendCodaDiscordMessage(config, pool, ids.guild, ids.user, { channelId: ids.general, content: 'Reply', replyTo: wrongChannelLink }, fetchImpl)).rejects.toThrow('selected Discord channel');
  });
});
