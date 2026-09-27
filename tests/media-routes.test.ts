import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAdminRouter, requireAdmin } from '../server/admin';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';
import { createMediaRouter } from '../server/media';
import type { OperationalSettings, SettingsStore } from '../server/settings';

const adminUserId = '00000000-0000-4000-8000-000000000001';
const viewerUserId = '00000000-0000-4000-8000-000000000002';
const worldId = '27d31940-108b-4dde-975d-bd8c1a327f83';
const imageId = '5d1f2a10-0000-4000-8000-000000000001';

const config = loadConfig({
  NODE_ENV: 'test', PORT: '8789', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test',
  SESSION_SECRET: 'media-route-test-secret-long-enough-value', SESSION_COOKIE_NAME: 'orbis.sid', TRUST_PROXY: 'false',
  DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'secret', DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  DISCORD_GUILD_ID: '1544909655275208716', DISCORD_ADULT_ROLE_IDS: '111111111111111111', DISCORD_CREATOR_ROLE_IDS: '',
  DISCORD_ADMIN_ROLE_IDS: '222222222222222222', DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS: '333333333333333333',
  DISCORD_INVITE_URL: '', VITE_DISCORD_INVITE_URL: '', ORBIS_VERSION: 'test', ORBIS_BUILD_SHA: 'test',
  ORBIS_MEDIA_ROOT: '/tmp/orbis-media-route-test',
});

const settingsStore = {
  getEffective: async () => ({
    guildId: '1544909655275208716', adultRoleIds: [], effectiveCreatorRoleIds: [], adminRoleIds: [],
    bootstrapAdminRoleIds: [], inviteUrl: '',
  }),
  update: async (_actor: string, value: OperationalSettings) => value,
  getAudit: async () => [],
} as unknown as SettingsStore;

const imageRow = {
  id: imageId, asset_id: worldId, kind: 'cover', storage_kind: 'local', storage_path: `${worldId}/${imageId}.png`,
  external_url: null, file_name: 'cover.png', mime_type: 'image/png', byte_size: 12, width: 1600, height: 900,
  caption: 'The ridge', alt_text: 'A rocky ridge', focal_x: 0.5, focal_y: 0.5, position: 0,
  created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-01T00:00:00Z'),
};

type AssetOverrides = Partial<Record<string, unknown>>;

function mediaApp(options: {
  session: Record<string, unknown>;
  asset?: Record<string, unknown>;
  image?: Record<string, unknown>;
}) {
  const asset = {
    id: worldId, type: 'world', name: 'Bitterroot', creator_user_id: adminUserId, content_rating: 'sfw',
    document: { worldSettings: { visibility: 'private', showInLibrary: false } },
    origin_world_document: null, origin_world_creator_user_id: null,
    ...options.asset,
  };
  const pool = {
    query: async (sql: string) => {
      if (sql.startsWith('UPDATE library_asset_images')) return { rows: [{ ...(options.image ?? imageRow), caption: 'x' }], rowCount: 1 };
      if (sql.includes('FROM library_asset_images')) return { rows: [options.image ?? imageRow], rowCount: 1 };
      if (sql.includes('FROM library_assets a')) return { rows: [asset], rowCount: 1 };
      if (sql.startsWith('SELECT discord_id FROM users')) return { rows: [{ discord_id: '999999999999999999' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DatabasePool;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'session', { value: options.session, configurable: true });
    next();
  });
  app.use('/api/v1/library', createMediaRouter(config, pool));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (error as { status?: number }).status;
    res.status(typeof status === 'number' ? status : 500).json({ error: (error as Error).message });
  });
  return app;
}

const ownerSession = { userId: adminUserId, discordUserId: '999999999999999999', access: { isGuildMember: true, canViewAdult: false, canCreate: true, canAdmin: false, checkedAt: Date.now() } };
const strangerSession = { userId: viewerUserId, discordUserId: '888888888888888888', access: { isGuildMember: true, canViewAdult: false, canCreate: true, canAdmin: false, checkedAt: Date.now() } };
const verifiedAdultSession = { ...strangerSession, access: { ...strangerSession.access, canViewAdult: true } };

describe('Orbis media access control', () => {
  it('lists a record\u2019 own images for its owner', async () => {
    const response = await request(mediaApp({ session: ownerSession })).get(`/api/v1/library/assets/${worldId}/images`).expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ id: imageId, kind: 'cover', width: 1600, height: 900 });
  });

  it('hides images of a private world from everyone but its owner and a super-admin', async () => {
    await request(mediaApp({ session: strangerSession })).get(`/api/v1/library/assets/${worldId}/images`).expect(404);
    const superAdminSession = { ...strangerSession, discordUserId: '1544473372073791602' };
    await request(mediaApp({ session: superAdminSession })).get(`/api/v1/library/assets/${worldId}/images`).expect(200);
  });

  it('refuses to hand adult artwork to an unverified viewer', async () => {
    const adult = { content_rating: 'adult', document: { worldSettings: { visibility: 'public', showInLibrary: true } } };
    await request(mediaApp({ session: strangerSession, asset: adult })).get(`/api/v1/library/assets/${worldId}/images`).expect(403);
    await request(mediaApp({ session: verifiedAdultSession, asset: adult })).get(`/api/v1/library/assets/${worldId}/images`).expect(200);
  });

  it('requires a real image id and refuses external artwork through the media route', async () => {
    await request(mediaApp({ session: ownerSession })).get('/api/v1/library/media/not-a-uuid').expect(400);
    await request(mediaApp({ session: ownerSession, image: { ...imageRow, storage_kind: 'external', storage_path: null, external_url: 'https://example.com/a.png' } }))
      .get(`/api/v1/library/media/${imageId}`).expect(404);
  });

  it('refuses image changes from anyone but the record owner or a super-admin', async () => {
    await request(mediaApp({ session: strangerSession })).patch(`/api/v1/library/assets/${worldId}/images/${imageId}`).send({ caption: 'x' }).expect(403);
    await request(mediaApp({ session: { ...strangerSession, discordUserId: '1544473372073791602' } }))
      .patch(`/api/v1/library/assets/${worldId}/images/${imageId}`).send({ caption: 'x' }).expect(200);
  });

  it('requires sign-in before any image change', async () => {
    await request(mediaApp({ session: {} })).patch(`/api/v1/library/assets/${worldId}/images/${imageId}`).send({ caption: 'x' }).expect(401);
  });

  it('rejects a malformed image id before touching the database', async () => {
    await request(mediaApp({ session: ownerSession })).patch(`/api/v1/library/assets/${worldId}/images/not-a-uuid`).send({}).expect(400);
    await request(mediaApp({ session: ownerSession })).delete(`/api/v1/library/assets/${worldId}/images/not-a-uuid`).expect(400);
  });

  it('rejects an upload that is not a supported image', async () => {
    await request(mediaApp({ session: ownerSession }))
      .post(`/api/v1/library/assets/${worldId}/images`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<svg onload="alert(1)"></svg>'))
      .expect(415);
  });

  it('reports an oversized upload as a 413 rather than a generic failure', async () => {
    await request(mediaApp({ session: ownerSession }))
      .post(`/api/v1/library/assets/${worldId}/images`)
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(1024 * 1024 + 64))
      .expect(413);
  });

  it('requires an HTTPS external image URL', async () => {
    await request(mediaApp({ session: ownerSession }))
      .post(`/api/v1/library/assets/${worldId}/images`)
      .send({ storageKind: 'external', url: 'http://example.com/a.png', kind: 'gallery' })
      .expect(400);
  });
});

describe('Orbis super-admin view preferences', () => {
  function adminPreferenceApp(hidePrivateUserWorlds: boolean) {
    const pool = { query: async () => ({ rows: [{ hide_private_user_worlds: hidePrivateUserWorlds }], rowCount: 1 }) } as unknown as DatabasePool;
    const viewPreferences = {
      get: async () => ({ hidePrivateUserWorlds }),
      set: async (_userId: string, input: { hidePrivateUserWorlds?: boolean }) => ({ hidePrivateUserWorlds: input.hidePrivateUserWorlds ?? hidePrivateUserWorlds }),
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'session', { value: { userId: adminUserId, discordUserId: '1544473372073791602', access: { isGuildMember: true, canViewAdult: true, canCreate: true, canAdmin: true, checkedAt: Date.now() } }, configurable: true });
      next();
    });
    app.use('/api/admin', requireAdmin(config, settingsStore), createAdminRouter(config, pool, settingsStore, viewPreferences));
    return app;
  }

  it('defaults to hiding other members\u2019 private worlds', async () => {
    const response = await request(adminPreferenceApp(true)).get('/api/admin/view-preferences').expect(200);
    expect(response.body.preferences).toEqual({ hidePrivateUserWorlds: true });
  });

  it('remembers the preference when it is turned off', async () => {
    const response = await request(adminPreferenceApp(false)).get('/api/admin/view-preferences').expect(200);
    expect(response.body.preferences).toEqual({ hidePrivateUserWorlds: false });
  });

  it('refuses a preference that is not a boolean', async () => {
    await request(adminPreferenceApp(true)).put('/api/admin/view-preferences').send({ hidePrivateUserWorlds: 'nope' }).expect(400);
  });

  it('refuses unknown view preferences so the filter cannot be widened by accident', async () => {
    await request(adminPreferenceApp(true)).put('/api/admin/view-preferences').send({ showEverything: true }).expect(400);
  });

  it('stays behind administrator access', async () => {
    const anonymous = express();
    anonymous.use(express.json());
    anonymous.use((req, _res, next) => {
      Object.defineProperty(req, 'session', { value: {}, configurable: true });
      next();
    });
    const noPreferences = { get: async () => ({ hidePrivateUserWorlds: true }), set: async () => ({ hidePrivateUserWorlds: true }) };
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as DatabasePool;
    anonymous.use('/api/admin', requireAdmin(config, settingsStore), createAdminRouter(config, pool, settingsStore, noPreferences));
    await request(anonymous).get('/api/admin/view-preferences').expect(401);
    await request(anonymous).put('/api/admin/view-preferences').send({ hidePrivateUserWorlds: false }).expect(401);
  });
});
