import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { BITTERROOT_OWNER_DISCORD_ID, buildBitterrootSeedAssets, type BitterrootSourceWorld } from '../server/bitterroot-import';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';
import { createLibraryRouter } from '../server/library';
import type { SettingsStore } from '../server/settings';
import source from '../server/data/bitterroot.json';

const assets = buildBitterrootSeedAssets(source as unknown as BitterrootSourceWorld);

describe('Bitterroot canonical import', () => {
  it('assigns the collection to Eirvargr by immutable Discord identity', () => {
    expect(BITTERROOT_OWNER_DISCORD_ID).toBe('1544473372073791602');
  });

  it('maps every current Bitterroot source record into Orbis', () => {
    expect(assets).toHaveLength(30);
    expect(Object.fromEntries(['world', 'species', 'place', 'faction', 'society', 'family', 'memory', 'character'].map((type) => [type, assets.filter((asset) => asset.type === type).length]))).toEqual({
      world: 1, species: 2, place: 16, faction: 1, society: 6, family: 1, memory: 1, character: 2,
    });
  });

  it('gives every source record one stable and unique import identity', () => {
    const sourceIds = assets.map((asset) => asset.sourceAssetId);
    expect(new Set(sourceIds).size).toBe(assets.length);
    expect(sourceIds).toContain('world:public-bitterroot');
    expect(sourceIds).toContain('place:whispering-lake');
    expect(sourceIds).toContain('place:wardens-watchtower');
    expect(sourceIds).toContain('character:ragna-holt');
    expect(sourceIds).toContain('character:pip-holt');
  });

  it('preserves the canonical character relationships without inventing links', () => {
    const ragna = assets.find((asset) => asset.sourceAssetId === 'character:ragna-holt');
    const pip = assets.find((asset) => asset.sourceAssetId === 'character:pip-holt');
    expect(ragna?.document.factionSourceIds).toEqual(['boundary-wardens']);
    expect(pip?.document.factionSourceIds).toEqual([]);
    expect(ragna?.document.familySourceId).toBe('holt-family');
    expect(pip?.document.familySourceId).toBe('holt-family');
  });
});

const ownerUserId = 'f52fbc27-ba5a-49ca-8cb0-4aef90689fb2';
const otherUserId = '93f82c1a-00bf-46fb-85df-a58991c7609f';
const assetId = '27d31940-108b-4dde-975d-bd8c1a327f83';
const config = loadConfig({
  NODE_ENV: 'test', PORT: '8789', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test',
  SESSION_SECRET: 'bitterroot-editor-test-secret-long-enough', SESSION_COOKIE_NAME: 'orbis.sid', TRUST_PROXY: 'false',
  DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'secret', DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  DISCORD_GUILD_ID: '1544909655275208716', DISCORD_ADULT_ROLE_IDS: '111111111111111111', DISCORD_CREATOR_ROLE_IDS: '',
  DISCORD_ADMIN_ROLE_IDS: '222222222222222222', DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS: '333333333333333333',
  DISCORD_INVITE_URL: '', VITE_DISCORD_INVITE_URL: '', ORBIS_VERSION: 'test', ORBIS_BUILD_SHA: 'test',
});

const settingsStore = {
  getEffective: async () => ({ adultRoleIds: [], effectiveCreatorRoleIds: [], adminRoleIds: [], bootstrapAdminRoleIds: [], guildId: '' }),
} as unknown as SettingsStore;

function editorApp(userId: string, creatorUserId = ownerUserId, canCreate = true) {
  const current = {
    id: assetId, type: 'place', name: 'Brackenjaw', summary: 'Old summary', origin_world_id: null,
    creator_user_id: creatorUserId, source_type: 'public-curated', source_asset_id: 'place:brackenjaw-enclave',
    content_rating: 'sfw', tags: ['Bitterroot'], dependency_count: 0, pinned: false, visual_tone: 'mist',
    document: { sourceId: 'brackenjaw-enclave', name: 'Brackenjaw', description: 'Old description' },
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('SELECT discord_id FROM users')) return {
        rows: [{ discord_id: userId === ownerUserId ? BITTERROOT_OWNER_DISCORD_ID : '999999999999999999' }], rowCount: 1,
      };
      if (sql.startsWith('UPDATE users SET is_guild_member')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('SELECT * FROM library_assets')) return { rows: [current], rowCount: 1 };
      if (sql.startsWith('UPDATE library_assets SET')) return { rows: [{ ...current, name: values?.[1], document: JSON.parse(String(values?.[7])) }], rowCount: 1 };
      if (sql.startsWith('SELECT display_name')) return { rows: [{ display_name: 'Eirvargr', avatar_url: null }], rowCount: 1 };
      if (sql.startsWith('SELECT code, classification FROM speculus_catalog_registry')) return { rows: [{ code: 'SPC-P-KD41827', classification: 'place' }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as DatabasePool;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'session', { value: { userId, access: { isGuildMember: true, canViewAdult: true, canCreate, canAdmin: false, checkedAt: Date.now() } }, configurable: true });
    next();
  });
  app.use('/api/library', createLibraryRouter(config, pool, settingsStore));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({ error: 'Invalid request.' });
    return res.status(500).json({ error: 'Unexpected error.' });
  });
  return app;
}

describe('Bitterroot record editing', () => {
  it('lets the verified owner update the card and structured record together', async () => {
    const response = await request(editorApp(ownerUserId)).patch(`/api/library/assets/${assetId}`).send({
      name: 'Brackenjaw Enclave', summary: 'Updated', contentRating: 'sfw', tags: ['Bitterroot'], visualTone: 'forest',
      document: { sourceId: 'brackenjaw-enclave', name: 'Ignored old name', description: 'Updated description' },
    }).expect(200);
    expect(response.body.name).toBe('Brackenjaw Enclave');
    expect(response.body.document.name).toBe('Brackenjaw Enclave');
    expect(response.body.document.description).toBe('Updated description');
    expect(response.body.speculus).toEqual({ code: 'SPC-P-KD41827', classification: 'place' });
  });

  it('rejects edits from a different verified creator', async () => {
    await request(editorApp(otherUserId)).patch(`/api/library/assets/${assetId}`).send({ name: 'Stolen record' }).expect(403);
  });

  it('keeps an owner able to edit after their creator role is unavailable', async () => {
    const response = await request(editorApp(otherUserId, otherUserId, false))
      .patch(`/api/library/assets/${assetId}`)
      .send({ name: 'Still mine' })
      .expect(200);
    expect(response.body.name).toBe('Still mine');
    expect(response.body.canEdit).toBe(true);
  });
});
