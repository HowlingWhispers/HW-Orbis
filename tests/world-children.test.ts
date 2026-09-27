import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AdminViewPreferenceStore } from '../server/admin-view-preferences';
import { AssetWriteError } from '../server/asset-writes';
import { loadConfig } from '../server/config';
import type { DatabasePool } from '../server/db';
import { createLibraryRouter } from '../server/library';
import type { SettingsStore } from '../server/settings';
import { createWorldChild, listWorldChildren, updateWorldChild } from '../server/world-children';

const worldId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const childId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const parentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ownerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const config = loadConfig({
  NODE_ENV: 'test', PORT: '8789', APP_ORIGIN: 'http://localhost:5174', DATABASE_URL: 'postgres://test',
  SESSION_SECRET: 'world-children-test-secret-long-enough', SESSION_COOKIE_NAME: 'orbis.sid', TRUST_PROXY: 'false',
  DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'secret', DISCORD_REDIRECT_URI: 'http://localhost:5174/api/auth/discord/callback',
  DISCORD_GUILD_ID: '', DISCORD_ADULT_ROLE_IDS: '', DISCORD_CREATOR_ROLE_IDS: '', DISCORD_ADMIN_ROLE_IDS: '',
  DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS: '', DISCORD_INVITE_URL: '', VITE_DISCORD_INVITE_URL: '', ORBIS_VERSION: 'test', ORBIS_BUILD_SHA: 'test',
});

const settingsStore = { getEffective: async () => ({}) } as unknown as SettingsStore;
const preferences = {
  get: async () => ({ hidePrivateUserWorlds: false }),
  set: async () => ({ hidePrivateUserWorlds: false }),
} satisfies AdminViewPreferenceStore;

describe('world child canonical service', () => {
  it('groups stable canonical projections using only origin_world_id rows', async () => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        return {
          rows: [
            { id: parentId, type: 'place', name: 'Harbor', summary: 'By the sea', document: { worldEntryId: 'harbor', kind: 'city' } },
            { id: childId, type: 'memory', name: 'First Bell', summary: '', document: { worldEntryId: 'first-bell', year: 12 } },
          ],
          rowCount: 2,
        };
      },
    };

    const grouped = await listWorldChildren(db as never, worldId);

    expect(Object.keys(grouped)).toEqual(['locations', 'species', 'factions', 'societies', 'families', 'memories']);
    expect(grouped.locations).toEqual([{ kind: 'city', id: 'harbor', libraryAssetId: parentId, name: 'Harbor', description: 'By the sea' }]);
    expect(grouped.memories[0]).toEqual({ year: 12, id: 'first-bell', libraryAssetId: childId, title: 'First Bell' });
    expect(queries[0]).toContain('WHERE origin_world_id = $1');
    expect(queries[0]).toContain('ORDER BY created_at, id');
  });

  it.each([
    ['missing', []],
    ['cross-world', [{ id: parentId, type: 'place', origin_world_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', document: { worldEntryId: 'parent' } }]],
    ['non-place', [{ id: parentId, type: 'faction', origin_world_id: worldId, document: { worldEntryId: 'parent' } }]],
  ])('rejects a %s parent before inserting a canonical row', async (_label, parents) => {
    let inserts = 0;
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('FOR UPDATE')) return { rows: [{ id: worldId }], rowCount: 1 };
        if (sql === 'SELECT id, type, creator_user_id FROM library_assets WHERE id = $1') {
          return { rows: [{ id: worldId, type: 'world', creator_user_id: ownerId }], rowCount: 1 };
        }
        if (sql.includes("document->>'worldEntryId' = $1")) return { rows: parents, rowCount: parents.length };
        if (sql.startsWith('INSERT INTO library_assets')) inserts += 1;
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as unknown as DatabasePool;

    await expect(createWorldChild(pool, { userId: ownerId, isSuperAdmin: false }, worldId, {
      type: 'place', name: 'Child', document: { parentLocationId: parentId },
    })).rejects.toBeInstanceOf(AssetWriteError);
    expect(inserts).toBe(0);
  });

  it('creates exactly one canonical child through the shared asset write path', async () => {
    let canonicalInserts = 0;
    const pool = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('SELECT id FROM library_assets')) return { rows: [{ id: worldId }], rowCount: 1 };
        if (sql === 'SELECT id, type, creator_user_id FROM library_assets WHERE id = $1') {
          return { rows: [{ id: worldId, type: 'world', creator_user_id: ownerId }], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO library_assets ')) {
          canonicalInserts += 1;
          return {
            rows: [{
              id: childId, type: 'place', name: values?.[2], summary: '', origin_world_id: worldId,
              creator_user_id: ownerId, source_type: 'user-created', content_rating: 'sfw', tags: [],
              visual_tone: 'mist', document: JSON.parse(String(values?.[9])), updated_at: new Date('2026-01-01'),
            }],
            rowCount: 1,
          };
        }
        if (sql.startsWith('SELECT max(revision)')) return { rows: [{ revision: 0 }], rowCount: 1 };
        if (sql.startsWith('INSERT INTO library_asset_revisions')) return { rows: [], rowCount: 1 };
        if (sql.startsWith('SELECT document FROM library_assets')) return { rows: [{ document: {} }], rowCount: 1 };
        if (sql.startsWith('UPDATE library_assets SET document')) return { rows: [], rowCount: 1 };
        if (sql.includes('SET dependency_count')) return { rows: [], rowCount: 1 };
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as unknown as DatabasePool;

    const created = await createWorldChild(pool, { userId: ownerId, isSuperAdmin: false }, worldId, {
      type: 'place', name: 'Root', visualTone: 'mist', document: {},
    });

    expect(created.result.assetId).toBe(childId);
    expect(canonicalInserts).toBe(1);
  });

  it('rejects a cycle before updating the child row', async () => {
    const child = {
      id: childId, type: 'place', name: 'Child', summary: '', origin_world_id: worldId, creator_user_id: ownerId,
      content_rating: 'sfw', tags: [], visual_tone: 'mist', document: { worldEntryId: 'child' }, updated_at: new Date(),
    };
    const parent = { id: parentId, type: 'place', origin_world_id: worldId, document: { worldEntryId: 'parent', parentLocationId: 'child' } };
    let writes = 0;
    const pool = {
      query: async (sql: string) => {
        if (sql.startsWith('SELECT * FROM library_assets WHERE id = $1')) return { rows: [child], rowCount: 1 };
        if (sql.startsWith('SELECT id FROM library_assets')) return { rows: [{ id: worldId }], rowCount: 1 };
        if (sql.includes("document->>'worldEntryId' = $1")) return { rows: [parent], rowCount: 1 };
        if (sql.includes("origin_world_id = $1 AND type = 'place'")) return { rows: [child, parent], rowCount: 2 };
        if (sql.startsWith('UPDATE library_assets SET')) writes += 1;
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as unknown as DatabasePool;

    await expect(updateWorldChild(pool, { userId: ownerId, isSuperAdmin: false }, worldId, childId, {
      document: { worldEntryId: 'child', parentLocationId: 'parent' },
    })).rejects.toThrow('cycle');
    expect(writes).toBe(0);
  });
});

function routeApp(world: Record<string, unknown>, children: Record<string, unknown>[], session: Record<string, unknown> = {}) {
  const pool = {
    query: async (sql: string) => {
      if (sql.startsWith('SELECT id, type, creator_user_id, content_rating, document')) return { rows: [world], rowCount: 1 };
      if (sql.includes('WHERE origin_world_id = $1')) return { rows: children, rowCount: children.length };
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as DatabasePool;
  const app = express();
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'session', { value: session, configurable: true });
    next();
  });
  app.use('/api/v1/library', createLibraryRouter(config, pool, settingsStore, preferences));
  return app;
}

describe('GET world children', () => {
  const publicWorld = {
    id: worldId, type: 'world', creator_user_id: ownerId, content_rating: 'sfw',
    document: { worldSettings: { visibility: 'public' }, locations: [{ id: 'embedded-only', name: 'Must not leak' }] },
  };
  const canonical = [{
    id: childId, type: 'place', name: 'Canonical', summary: '', origin_world_id: worldId,
    document: { worldEntryId: 'canonical' }, created_at: new Date('2026-01-01'),
  }];

  it('returns exactly the grouped canonical response and ignores embedded children', async () => {
    const response = await request(routeApp(publicWorld, canonical)).get(`/api/v1/library/assets/${worldId}/children`).expect(200);
    expect(Object.keys(response.body)).toEqual(['locations', 'species', 'factions', 'societies', 'families', 'memories']);
    expect(response.body.locations).toEqual([{ id: 'canonical', libraryAssetId: childId, name: 'Canonical' }]);
    expect(JSON.stringify(response.body)).not.toContain('embedded-only');
  });

  it('applies normal direct private-world access', async () => {
    const privateWorld = { ...publicWorld, document: { worldSettings: { visibility: 'private' } } };
    await request(routeApp(privateWorld, canonical)).get(`/api/v1/library/assets/${worldId}/children`).expect(404);
    await request(routeApp(privateWorld, canonical, { userId: ownerId, discordUserId: 'ordinary' }))
      .get(`/api/v1/library/assets/${worldId}/children`).expect(200);
  });

  it('applies adult-content access while preserving owner access', async () => {
    const adultWorld = { ...publicWorld, content_rating: 'adult' };
    await request(routeApp(adultWorld, canonical)).get(`/api/v1/library/assets/${worldId}/children`).expect(403);
    await request(routeApp(adultWorld, canonical, { userId: ownerId, discordUserId: 'ordinary' }))
      .get(`/api/v1/library/assets/${worldId}/children`).expect(200);
  });
});
