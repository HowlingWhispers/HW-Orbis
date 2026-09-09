import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createAdminRouter, requireAdmin } from '../server/admin';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';
import { PostgresSettingsStore, resolveSettings, type AuditEntry, type EffectiveSettings, type OperationalSettings, type SettingsStore } from '../server/settings';

const ids = {
  guild: '1544909655275208716', adult: '111111111111111111', admin: '222222222222222222', recovery: '333333333333333333',
};

const config = loadConfig({
  NODE_ENV: 'test', PORT: '8789', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://secret-db-value',
  SESSION_SECRET: 'session-secret-value-that-is-long-enough', SESSION_COOKIE_NAME: 'orbis.sid', TRUST_PROXY: 'false',
  DISCORD_CLIENT_ID: 'client-id', DISCORD_CLIENT_SECRET: 'discord-secret-never-return-this',
  DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback', DISCORD_GUILD_ID: ids.guild,
  DISCORD_ADULT_ROLE_IDS: ids.adult, DISCORD_CREATOR_ROLE_IDS: '', DISCORD_ADMIN_ROLE_IDS: ids.admin,
  DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS: ids.recovery, DISCORD_INVITE_URL: '', VITE_DISCORD_INVITE_URL: '',
  ORBIS_VERSION: 'test-version', ORBIS_BUILD_SHA: 'test-sha',
});

class MemorySettingsStore implements SettingsStore {
  audit: AuditEntry[] = [];
  constructor(public value: EffectiveSettings = resolveSettings(config, {})) {}
  async getEffective() { return this.value; }
  async update(actorUserId: string, input: OperationalSettings) {
    this.audit.push({ id: '1', settingKey: 'discord.guild_id', previousValue: this.value.guildId, newValue: input.guildId, changedByUserId: actorUserId, changedByName: 'Admin', changedAt: new Date().toISOString() });
    this.value = { ...input, effectiveCreatorRoleIds: input.creatorRoleIds.length ? input.creatorRoleIds : input.adultRoleIds, creatorUsesAdultFallback: input.creatorRoleIds.length === 0, bootstrapAdminRoleIds: config.bootstrapAdminRoleIds, sources: { guildId: 'database', adultRoleIds: 'database', creatorRoleIds: 'database', adminRoleIds: 'database', inviteUrl: 'database' } };
    return this.value;
  }
  async getAudit() { return this.audit; }
}

function testApp(access: 'none' | 'ordinary' | 'admin', store = new MemorySettingsStore()) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    if (access !== 'none') Object.defineProperty(req, 'session', { value: { userId: '00000000-0000-4000-8000-000000000001', access: { isGuildMember: true, canViewAdult: false, canCreate: false, canAdmin: access === 'admin', checkedAt: Date.now() } }, configurable: true });
    else Object.defineProperty(req, 'session', { value: {}, configurable: true });
    next();
  });
  const pool = { query: async () => ({ rows: [{ '?column?': 1 }], rowCount: 1 }) } as unknown as DatabasePool;
  app.use('/api/admin', requireAdmin(config, store), createAdminRouter(config, pool, store));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({ error: 'Invalid request.' });
    return res.status(500).json({ error: 'Unexpected error.' });
  });
  return { app, store };
}

describe('Orbis administration API', () => {
  it('requires authentication', async () => { await request(testApp('none').app).get('/api/admin/settings').expect(401); });
  it('denies an ordinary signed-in user', async () => { await request(testApp('ordinary').app).get('/api/admin/settings').expect(403); });
  it('lets an administrator read effective settings', async () => {
    const response = await request(testApp('admin').app).get('/api/admin/settings').expect(200);
    expect(response.body.settings.guildId).toBe(ids.guild);
    expect(response.body.settings.creatorUsesAdultFallback).toBe(true);
  });
  it('validates, updates and audits non-secret settings', async () => {
    const { app, store } = testApp('admin');
    const response = await request(app).put('/api/admin/settings').send({ guildId: ids.guild, adultRoleIds: [ids.adult], creatorRoleIds: [], adminRoleIds: [ids.admin], inviteUrl: 'https://discord.gg/orbis' }).expect(200);
    expect(response.body.settings.inviteUrl).toBe('https://discord.gg/orbis');
    expect((store as MemorySettingsStore).audit).toHaveLength(1);
  });
  it('rejects malformed Discord IDs', async () => {
    await request(testApp('admin').app).put('/api/admin/settings').send({ guildId: 'not-an-id', adultRoleIds: [ids.adult], creatorRoleIds: [], adminRoleIds: [ids.admin], inviteUrl: '' }).expect(400);
  });
  it('rejects creator roles that are not also adult roles', async () => {
    await request(testApp('admin').app).put('/api/admin/settings').send({ guildId: ids.guild, adultRoleIds: [ids.adult], creatorRoleIds: [ids.admin], adminRoleIds: [ids.admin], inviteUrl: '' }).expect(400);
  });
  it('never discloses protected secret values', async () => {
    const response = await request(testApp('admin').app).get('/api/admin/overview').expect(200);
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('discord-secret-never-return-this');
    expect(body).not.toContain('postgres://secret-db-value');
    expect(body).not.toContain('session-secret-value-that-is-long-enough');
    expect(response.body.secrets.discordClientSecret).toBe('configured');
  });
});

describe('settings precedence and audit storage', () => {
  it('uses database values before environment values', () => {
    const resolved = resolveSettings(config, { 'discord.guild_id': '999999999999999999' });
    expect(resolved.guildId).toBe('999999999999999999');
    expect(resolved.sources.guildId).toBe('database');
  });
  it('makes the creator fallback explicit', () => {
    const resolved = resolveSettings(config, {});
    expect(resolved.creatorUsesAdultFallback).toBe(true);
    expect(resolved.effectiveCreatorRoleIds).toEqual([ids.adult]);
  });
  it('writes an audit row for every changed setting', async () => {
    const clientQueries: string[] = [];
    const client = { query: async (sql: string) => { clientQueries.push(sql); if (sql.startsWith('SELECT setting_key')) return { rows: [] }; return { rows: [], rowCount: 1 }; }, release: () => undefined };
    const finalRows = [
      { setting_key: 'discord.guild_id', setting_value: ids.guild }, { setting_key: 'discord.adult_role_ids', setting_value: [ids.adult] },
      { setting_key: 'discord.creator_role_ids', setting_value: [] }, { setting_key: 'discord.admin_role_ids', setting_value: [ids.admin] },
      { setting_key: 'discord.invite_url', setting_value: 'https://discord.gg/orbis' },
    ];
    const pool = { connect: async () => client, query: async () => ({ rows: finalRows }) } as unknown as DatabasePool;
    const store = new PostgresSettingsStore(pool, config);
    await store.update('00000000-0000-4000-8000-000000000001', { guildId: ids.guild, adultRoleIds: [ids.adult], creatorRoleIds: [], adminRoleIds: [ids.admin], inviteUrl: 'https://discord.gg/orbis' });
    expect(clientQueries.filter((sql) => sql.includes('INSERT INTO admin_setting_audit'))).toHaveLength(1);
  });
  it('blocks changes when no server-controlled recovery route exists', async () => {
    const unsafeConfig = loadConfig({ ...process.env, NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test', SESSION_SECRET: 'another-session-secret-long-enough', DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'secret', DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback', DISCORD_GUILD_ID: ids.guild, DISCORD_ADULT_ROLE_IDS: ids.adult, DISCORD_ADMIN_ROLE_IDS: ids.admin, DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS: '' });
    const pool = { connect: async () => { throw new Error('must not connect'); }, query: async () => ({ rows: [] }) } as unknown as DatabasePool;
    const store = new PostgresSettingsStore(pool, unsafeConfig);
    await expect(store.update('00000000-0000-4000-8000-000000000001', { guildId: ids.guild, adultRoleIds: [ids.adult], creatorRoleIds: [], adminRoleIds: [ids.admin], inviteUrl: '' })).rejects.toThrow('DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS');
  });
});
