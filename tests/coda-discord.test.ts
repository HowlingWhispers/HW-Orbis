import { describe, expect, it, vi } from 'vitest';
import {
  editCodaDiscordMessage, listCodaDiscordChannels, searchCodaDiscordMembers, sendCodaDirectMessage, sendCodaDiscordMessage,
} from '../server/coda-discord';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';

const ids = {
  guild: '1544909655275208716',
  general: '111111111111111111',
  admin: '222222222222222222',
  blocked: '333333333333333333',
  message: '444444444444444444',
  dmChannel: '555555555555555555',
  recipient: '666666666666666666',
  user: '00000000-0000-4000-8000-000000000001',
};

const config = loadConfig({
  NODE_ENV: 'test', PORT: '8789', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test',
  SESSION_SECRET: 'session-secret-value-that-is-long-enough', SESSION_COOKIE_NAME: 'orbis.sid', TRUST_PROXY: 'false',
  DISCORD_CLIENT_ID: 'client-id', DISCORD_CLIENT_SECRET: 'discord-secret',
  DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback', DISCORD_GUILD_ID: ids.guild,
  CODA_DISCORD_BOT_TOKEN: 'coda-bot-token', CODA_DISCORD_CHANNEL_IDS: ids.general + ',' + ids.admin,
  DISCORD_ADULT_ROLE_IDS: '', DISCORD_CREATOR_ROLE_IDS: '', DISCORD_ADMIN_ROLE_IDS: '',
  DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS: '', DISCORD_INVITE_URL: '', VITE_DISCORD_INVITE_URL: '',
});

function poolWithAudit() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('FROM coda_control_state')) return { rows: [{ outbound_enabled: true }], rowCount: 1 };
      if (sql.includes('INSERT INTO coda_discord_messages')) return { rows: [{ id: '17', created_at: new Date('2026-09-26T00:00:00Z') }], rowCount: 1 };
      if (sql.includes('FROM coda_discord_messages WHERE id')) return { rows: [{ id: '17', channel_id: ids.general, discord_message_id: ids.message, content: 'Old', destination_type: 'channel', deleted_at: null }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as DatabasePool;
  return { pool, queries };
}

describe('Coda Discord command center', () => {
  it('only exposes allowlisted text-capable channels', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([
      { id: ids.general, type: 0, name: 'general', position: 2 },
      { id: ids.admin, type: 5, name: 'announcements', position: 1 },
      { id: ids.blocked, type: 0, name: 'blocked', position: 0 },
      { id: '777777777777777777', type: 2, name: 'voice', position: 0 },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await listCodaDiscordChannels(config, ids.guild, fetchImpl);
    expect(result.items.map((channel) => channel.id)).toEqual([ids.admin, ids.general]);
  });

  it('posts through the bot token and records the administrative send', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.endsWith('/guilds/' + ids.guild + '/channels')) return new Response(JSON.stringify([{ id: ids.general, type: 0, name: 'general', position: 0 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ id: ids.message }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const { pool, queries } = poolWithAudit();
    const result = await sendCodaDiscordMessage(config, pool, ids.guild, ids.user, { channelId: ids.general, content: 'Hello from Coda!', replyTo: '' }, fetchImpl);
    expect(result.message.discordMessageId).toBe(ids.message);
    const post = calls.find((call) => call.url.endsWith('/channels/' + ids.general + '/messages'));
    expect(post?.init?.headers).toMatchObject({ Authorization: 'Bot coda-bot-token' });
    expect(queries.some((query) => query.sql.includes('INSERT INTO coda_discord_messages'))).toBe(true);
  });

  it('rejects a destination outside the server allowlist before posting', async () => {
    const fetchImpl = vi.fn();
    const { pool } = poolWithAudit();
    await expect(sendCodaDiscordMessage(config, pool, ids.guild, ids.user, { channelId: ids.blocked, content: 'Nope', replyTo: '' }, fetchImpl)).rejects.toThrow('allowlist');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('searches Discord members and resolves their display names', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ nick: 'David Silver', user: { id: ids.recipient, username: 'david', global_name: 'David' } }]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await searchCodaDiscordMembers(config, ids.guild, 'David', fetchImpl);
    expect(result[0]).toMatchObject({ id: ids.recipient, displayName: 'David Silver', username: 'david' });
  });

  it('opens a DM channel and sends a private message', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/guilds/' + ids.guild + '/members/' + ids.recipient)) return new Response(JSON.stringify({ nick: 'David', user: { id: ids.recipient, username: 'david' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/users/@me/channels')) return new Response(JSON.stringify({ id: ids.dmChannel }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ id: ids.message }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const { pool } = poolWithAudit();
    const result = await sendCodaDirectMessage(config, pool, ids.guild, ids.user, { recipient: ids.recipient, content: 'Private hello!' }, fetchImpl);
    expect(result.message.destinationType).toBe('dm');
    expect(result.message.recipientUserId).toBe(ids.recipient);
    expect(calls.some((url) => url.endsWith('/channels/' + ids.dmChannel + '/messages'))).toBe(true);
  });

  it('edits a previously sent Coda message', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: ids.message, content: 'New' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const { pool, queries } = poolWithAudit();
    await editCodaDiscordMessage(config, pool, '17', 'New', fetchImpl);
    expect(queries.some((query) => query.sql.includes('edited_at = now()'))).toBe(true);
  });

  it('blocks outbound sends when Coda is in the kennel', async () => {
    const pool = { query: async (sql: string) => sql.includes('FROM coda_control_state') ? { rows: [{ outbound_enabled: false }], rowCount: 1 } : { rows: [], rowCount: 0 } } as unknown as DatabasePool;
    await expect(sendCodaDiscordMessage(config, pool, ids.guild, ids.user, { channelId: ids.general, content: 'Nope', replyTo: '' }, vi.fn())).rejects.toThrow('kennel');
  });
});
