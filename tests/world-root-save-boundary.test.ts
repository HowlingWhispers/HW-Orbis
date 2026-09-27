import { describe, expect, it } from 'vitest';
import { applyAssetUpdate } from '../server/asset-writes';
import type { DatabasePool } from '../server/db';

const worldId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';

const storedProjection = [
  { id: 'harbor', libraryAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Harbor', kind: 'city' },
  { id: 'market', libraryAssetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Market', kind: 'building' },
];

/**
 * A world root save carrying a stale `document.locations` array. The payload is
 * exactly what a client that loaded the world before a canonical Place edit
 * would submit: it drops a place, renames another, and invents a new one.
 */
function rootSaveWorld() {
  return {
    id: worldId,
    type: 'world',
    name: 'Hollowmere',
    summary: 'A quiet town.',
    origin_world_id: null,
    creator_user_id: ownerId,
    source_type: 'user-created',
    content_rating: 'sfw',
    tags: [],
    visual_tone: 'mist',
    updated_at: new Date('2026-01-01'),
    document: {
      identity: { name: 'Hollowmere' },
      lore: { history: 'Old history.' },
      locations: storedProjection,
      species: [{ id: 'wolves', name: 'Wolves' }],
      worldSettings: { visibility: 'public', showInLibrary: true, allowForking: false },
    },
  };
}

type SaveRecord = {
  stored: ReturnType<typeof rootSaveWorld>;
  inserted: string[];
  updates: string[];
  projected: string[];
  removed: string[];
};

function rootSavePool(record: SaveRecord) {
  const staleLocations = [
    { id: 'market', libraryAssetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Renamed Market', kind: 'building' },
    { id: 'invented', name: 'Invented Inn', kind: 'building' },
  ];
  return {
    query: async (sql: string, values?: unknown[]) => {
      if (sql === 'SELECT * FROM library_assets WHERE id = $1') return { rows: [record.stored], rowCount: 1 };
      if (sql === 'SELECT * FROM library_assets WHERE id = $1 FOR UPDATE') return { rows: [record.stored], rowCount: 1 };
      if (sql.startsWith('SELECT max(revision)')) return { rows: [{ revision: 3 }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO library_asset_revisions')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('INSERT INTO library_assets')) {
        record.inserted.push(JSON.stringify(values ?? []));
        return { rows: [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT document FROM library_assets')) {
        return { rows: [{ document: record.stored.document }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE library_assets SET document')) {
        record.projected.push(String(values?.[1] ?? ''));
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE library_assets SET name=')) {
        record.updates.push(String(values?.[7] ?? ''));
        return { rows: [{ ...record.stored, document: JSON.parse(String(values?.[7])) }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM library_assets')) record.removed.push(String(values?.[0] ?? ''));
      if (sql.startsWith('SELECT')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('UPDATE library_assets')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as DatabasePool;
}

describe('world root save boundary for canonical Places', () => {
  it('never lets a stale embedded locations array update or delete a canonical Place', async () => {
    const record = {
      stored: rootSaveWorld(),
      inserted: [] as string[],
      updates: [] as string[],
      projected: [] as string[],
      removed: [] as string[],
    };
    const pool = rootSavePool(record);

    const { result } = await applyAssetUpdate(pool, { userId: ownerId, isSuperAdmin: false }, worldId, {
      name: 'Hollowmere',
      document: {
        identity: { name: 'Hollowmere' },
        lore: { history: 'Newly authored history.' },
        locations: [
          { id: 'market', libraryAssetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Renamed Market', kind: 'building' },
          { id: 'invented', name: 'Invented Inn', kind: 'building' },
        ],
        species: [{ id: 'wolves', name: 'Wolves' }],
      },
    });

    expect(result.changedFields).toContain('document');

    // Only the still root-authored `species` collection may create canonical
    // rows. Places must not, even though the submitted array invented one.
    const insertedTypes = record.inserted.map((values) => JSON.parse(values)[1]);
    expect(insertedTypes).toEqual(['species']);
    expect(record.removed).toEqual([]);

    // What was actually written keeps the stored Places projection untouched, so
    // the stale "Renamed Market" and "Invented Inn" never reach a child row.
    expect(record.updates).toHaveLength(1);
    const written = JSON.parse(record.updates[0]) as Record<string, unknown>;
    expect((written.lore as Record<string, unknown>).history).toBe('Newly authored history.');
    expect(written.locations).toEqual(storedProjection);
  });

  it('excludes Places from embedded-to-canonical synchronization but keeps other collections', async () => {
    const record = {
      stored: rootSaveWorld(),
      inserted: [] as string[],
      updates: [] as string[],
      projected: [] as string[],
      removed: [] as string[],
    };
    const pool = rootSavePool(record);

    await applyAssetUpdate(pool, { userId: ownerId, isSuperAdmin: false }, worldId, {
      document: { ...record.stored.document, lore: { history: 'Changed.' } },
    });

    // Every projection rebuild keeps the stored Places, so a root save cannot
    // delete authored world data that has no canonical row yet.
    expect(record.projected.length).toBeGreaterThan(0);
    for (const payload of record.projected) {
      const projected = JSON.parse(payload) as Record<string, unknown>;
      expect(projected.locations).toEqual(storedProjection);
    }
  });

  it('still author world-level collections and canonical child writes', async () => {
    const record = {
      stored: rootSaveWorld(),
      inserted: [] as string[],
      updates: [] as string[],
      projected: [] as string[],
      removed: [] as string[],
    };
    const pool = rootSavePool(record);

    await applyAssetUpdate(pool, { userId: ownerId, isSuperAdmin: false }, worldId, {
      document: {
        ...record.stored.document,
        locations: [{ id: 'stale', name: 'Ignored' }],
        species: [{ id: 'wolves', name: 'Wolves', description: 'Edited.' }],
      },
    });

    const written = JSON.parse(record.updates[0]) as Record<string, unknown>;
    expect(written.species).toEqual([{ id: 'wolves', name: 'Wolves', description: 'Edited.' }]);
    expect(written.locations).toEqual(storedProjection);
  });
});
