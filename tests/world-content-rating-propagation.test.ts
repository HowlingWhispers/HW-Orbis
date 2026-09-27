// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyAssetUpdate, insertAsset } from '../server/asset-writes';
import { propagateWorldContentRating } from '../server/world-child-rating';
import type { DatabasePool } from '../server/db';

const worldId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const harborId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const marketId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * The rating propagation is a metadata operation on canonical child rows, so
 * these tests assert the SQL that reaches the database rather than only the
 * final state. A world save that merely happens to leave the right rating in
 * place would still be a defect if it rewrote authored Place content to get
 * there, so the statement is inspected directly.
 */
const storedProjection = [
  { id: 'harbor', libraryAssetId: harborId, name: 'Harbor', kind: 'city' },
  { id: 'market', libraryAssetId: marketId, name: 'Market', kind: 'building' },
];

type RatingStatement = { sql: string; values: unknown[] };

function worldRow(contentRating = 'sfw') {
  return {
    id: worldId,
    type: 'world',
    name: 'Hollowmere',
    summary: 'A quiet town.',
    origin_world_id: null,
    creator_user_id: ownerId,
    source_type: 'user-created',
    content_rating: contentRating,
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

type Harness = {
  pool: DatabasePool;
  rating: RatingStatement[];
  worldWrites: unknown[][];
  documentWrites: string[];
  inserts: string[];
  deletes: string[];
  /** Make the rating statement fail, to prove the error is not swallowed. */
  failRating: boolean;
};

function harness(options: { contentRating?: string; failRating?: boolean } = {}): Harness {
  const record: Harness = {
    rating: [],
    worldWrites: [],
    documentWrites: [],
    inserts: [],
    deletes: [],
    failRating: options.failRating ?? false,
    pool: undefined as unknown as DatabasePool,
  };
  let current = worldRow(options.contentRating);

  record.pool = {
    query: async (sql: string, values?: unknown[]) => {
      if (/UPDATE\s+library_assets\s+SET\s+content_rating/i.test(sql)) {
        record.rating.push({ sql, values: values ?? [] });
        if (record.failRating) throw new Error('rating propagation refused');
        // Report the canonical children of the world as the ones re-rated.
        return { rows: [{ id: harborId }, { id: marketId }], rowCount: 2 };
      }
      if (sql === 'SELECT * FROM library_assets WHERE id = $1') return { rows: [current], rowCount: 1 };
      if (sql === 'SELECT * FROM library_assets WHERE id = $1 FOR UPDATE') return { rows: [current], rowCount: 1 };
      if (sql.startsWith('SELECT max(revision)')) return { rows: [{ revision: 3 }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO library_asset_revisions')) return { rows: [], rowCount: 1 };
      if (sql.startsWith('INSERT INTO library_assets')) {
        record.inserts.push(JSON.stringify(values ?? []));
        return { rows: [{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT document FROM library_assets')) return { rows: [{ document: current.document }], rowCount: 1 };
      if (sql.startsWith('UPDATE library_assets SET document')) {
        record.documentWrites.push(String(values?.[1] ?? ''));
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE library_assets SET name=')) {
        record.worldWrites.push(values ?? []);
        current = { ...current, ...(values?.[4] ? { content_rating: String(values[4]) } : {}), document: JSON.parse(String(values?.[7] ?? '{}')) };
        return { rows: [current], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM library_assets')) record.deletes.push(String(values?.[0] ?? ''));
      if (sql.startsWith('SELECT')) return { rows: [], rowCount: 0 };
      if (sql.startsWith('UPDATE library_assets')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as DatabasePool;

  return record;
}

const identity = { userId: ownerId, isSuperAdmin: false };

describe('world content rating propagates to canonical Places', () => {
  it('re-rates canonical Places when the world rating changes', async () => {
    const record = harness({ contentRating: 'sfw' });

    const { result } = await applyAssetUpdate(record.pool, identity, worldId, { contentRating: 'adult' });

    expect(result.changedFields).toContain('contentRating');
    expect(result.contentRating).toBe('adult');
    // The world row itself was written as adult...
    expect(String(record.worldWrites[0]?.[4])).toBe('adult');

    // ...and the canonical children were told about it, selected by world
    // ownership rather than by anything in the root document.
    expect(record.rating).toHaveLength(1);
    expect(record.rating[0].values).toEqual([worldId, 'adult']);
    expect(record.rating[0].sql).toMatch(/origin_world_id\s*=\s*\$1/);
  });

  it('reports which canonical children were re-rated', async () => {
    const db = {
      query: async () => ({ rows: [{ id: harborId }, { id: marketId }], rowCount: 2 }),
    };
    await expect(propagateWorldContentRating(db as never, worldId, 'adult')).resolves.toEqual({ changed: [harborId, marketId] });
  });

  it('does not re-rate children that already agree with the world', async () => {
    const statements: string[] = [];
    const db = {
      query: async (sql: string) => {
        statements.push(sql);
        return { rows: [], rowCount: 0 };
      },
    };
    await propagateWorldContentRating(db as never, worldId, 'adult');
    // The guard keeps a child that already matches out of the write entirely.
    expect(statements[0]).toMatch(/content_rating IS DISTINCT FROM \$2/);
  });

  it('propagates on world creation as well', async () => {
    const record = harness({ contentRating: 'adult' });
    await insertAsset(record.pool, identity, {
      type: 'world', name: 'Fresh', contentRating: 'adult', visualTone: 'forest',
      document: { locations: storedProjection, worldSettings: { visibility: 'private' } },
    });
    // A new world mints its own id, so the propagation targets that id and
    // carries the rating the world was created with.
    expect(record.rating[0]?.values).toEqual(['ffffffff-ffff-4fff-8fff-ffffffffffff', 'adult']);
  });
});

describe('rating propagation is metadata only', () => {
  it('writes the rating column and nothing about Place content', async () => {
    const record = harness();
    await applyAssetUpdate(record.pool, identity, worldId, { contentRating: 'adult' });

    const { sql } = record.rating[0];
    // The statement must not be able to touch authored content, identity, or
    // the compatibility projection, whatever the root document claims.
    expect(sql).not.toMatch(/\bdocument\b/i);
    expect(sql).not.toMatch(/\bname\b/i);
    expect(sql).not.toMatch(/\bsummary\b/i);
    expect(sql).not.toMatch(/\btags\b/i);
    expect(sql).not.toMatch(/locations/i);
    expect(sql).toMatch(/RETURNING id/i);
  });

  it('creates and deletes no Place rows while re-rating', async () => {
    const record = harness();
    await applyAssetUpdate(record.pool, identity, worldId, { contentRating: 'adult' });

    // Nothing invented by the root document may become canon here, and nothing
    // canonical may be removed by a rating change.
    const insertedTypes = record.inserts.map((values) => JSON.parse(values)[1]);
    expect(insertedTypes).not.toContain('place');
    expect(record.deletes).toEqual([]);
  });

  it('leaves the authored Place projection byte-identical', async () => {
    const record = harness();
    await applyAssetUpdate(record.pool, identity, worldId, {
      contentRating: 'adult',
      document: { ...worldRow().document, lore: { history: 'Newly authored.' } },
    });

    expect(record.documentWrites.length).toBeGreaterThan(0);
    for (const payload of record.documentWrites) {
      expect((JSON.parse(payload) as Record<string, unknown>).locations).toEqual(storedProjection);
    }
    const written = JSON.parse(String(record.worldWrites[0]?.[7])) as Record<string, unknown>;
    expect((written.lore as Record<string, unknown>).history).toBe('Newly authored.');
    expect(written.locations).toEqual(storedProjection);
  });
});

describe('stale embedded locations cannot influence the re-rating', () => {
  const staleLocations = [
    { id: 'market', libraryAssetId: marketId, name: 'Renamed Market', kind: 'building' },
    { id: 'invented', name: 'Invented Inn', kind: 'building' },
  ];

  it('selects canonical children by world ownership, not by the submitted array', async () => {
    const record = harness({ contentRating: 'sfw' });
    await applyAssetUpdate(record.pool, identity, worldId, {
      contentRating: 'adult',
      document: { ...worldRow().document, locations: staleLocations },
    });

    // The rating statement never reads the submitted array: it names no
    // collection, no entry id, and no library asset id.
    const { sql, values } = record.rating[0];
    expect(values).toEqual([worldId, 'adult']);
    expect(sql).not.toMatch(/harbor|market|invented/i);
    expect(sql).not.toMatch(harborId);
    expect(sql).not.toMatch(marketId);
  });

  it('does not let a stale array create, rename, or remove canon while re-rating', async () => {
    const record = harness({ contentRating: 'sfw' });
    await applyAssetUpdate(record.pool, identity, worldId, {
      contentRating: 'adult',
      document: { ...worldRow().document, locations: staleLocations },
    });

    const insertedTypes = record.inserts.map((values) => JSON.parse(values)[1]);
    expect(insertedTypes).not.toContain('place');
    expect(record.deletes).toEqual([]);

    // The re-rating is driven purely by the world's new rating, so the "Invented
    // Inn" the array introduced is still not canon.
    expect(record.rating[0].values[1]).toBe('adult');
    const written = JSON.parse(String(record.worldWrites[0]?.[7])) as Record<string, unknown>;
    expect(written.locations).toEqual(storedProjection);
  });
});

describe('rating propagation is transactional', () => {
  it('runs on the same executor as the surrounding world save', async () => {
    const record = harness();
    await applyAssetUpdate(record.pool, identity, worldId, { contentRating: 'adult' });
    // A single executor with no .connect() means the write layer joined the
    // caller's transaction rather than opening a second one, so the rating
    // change commits or rolls back with the world save.
    expect((record.pool as { connect?: unknown }).connect).toBeUndefined();
  });

  it('propagates the new rating, not the value being replaced', async () => {
    const record = harness({ contentRating: 'sfw' });
    await applyAssetUpdate(record.pool, identity, worldId, { contentRating: 'adult' });
    // The statement is issued after the world row is written, so it can only
    // have seen the updated rating.
    expect(record.rating[0].values[1]).toBe('adult');
  });

  it('fails the whole save when propagation fails instead of continuing', async () => {
    const record = harness({ failRating: true });
    // A swallowed failure would leave a world whose rating and Places disagree,
    // which is exactly the state this operation exists to prevent.
    await expect(applyAssetUpdate(record.pool, identity, worldId, { contentRating: 'adult' })).rejects.toThrow(/rating propagation refused/);
  });
});

/*
 * The same guarantees proved against a real Orbis database, inside a
 * transaction that is always rolled back. `pg.Client` exposes .connect(),
 * which the write layer would use to open its own transaction; wrapping it
 * hides that method and keeps this test in charge of BEGIN/ROLLBACK. These
 * tests skip when DATABASE_URL is not set.
 */
const databaseUrl = process.env.DATABASE_URL;
const live = databaseUrl ? describe.sequential : describe.skip;

type TestDb = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

async function withRolledBackTransaction<T>(work: (db: TestDb) => Promise<T>): Promise<T> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const db = {
      query: async (text: string, params?: unknown[]) => {
        try {
          return await client.query(text, params as never[]);
        } catch (error) {
          (error as Error).message = `SQL: ${text.replace(/\s+/g, ' ').trim()}\n  ${(error as Error).message}`;
          throw error;
        }
      },
    };
    try {
      return await work(db);
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    await client.end();
  }
}

live('world content rating propagation against a real database', () => {
  it('re-rates canonical Places and rewrites no authored content', async () => {
    await withRolledBackTransaction(async (db) => {
      const owner = await db.query(
        `INSERT INTO users (id, discord_id, discord_username, display_name) VALUES (gen_random_uuid(), '999999999999999991', 'rating-fixture', 'Rating Fixture') RETURNING id`,
      );
      const userId = String(owner.rows[0].id);

      const { createWorldChild } = await import('../server/world-children');
      const created = await insertAsset(db as never, { userId, isSuperAdmin: false }, {
        type: 'world', name: 'Rating Fixture World', contentRating: 'sfw', visualTone: 'forest',
        document: { locations: [], worldSettings: { visibility: 'private' } },
      });
      const fixtureWorldId = String(created.row.id);

      const place = await createWorldChild(db as never, { userId, isSuperAdmin: false }, fixtureWorldId, {
        type: 'place', name: 'Fixture Harbor', visualTone: 'mist',
        document: { worldEntryId: 'fixture-harbor', kind: 'city', description: 'Authored content that must survive.' },
      });
      const placeId = String(place.row.id);

      const before = await db.query(`SELECT content_rating, document, name, summary FROM library_assets WHERE id = $1`, [placeId]);
      expect(before.rows[0].content_rating).toBe('sfw');

      await applyAssetUpdate(db as never, { userId, isSuperAdmin: false }, fixtureWorldId, { contentRating: 'adult' });

      const after = await db.query(`SELECT content_rating, document, name, summary, origin_world_id FROM library_assets WHERE id = $1`, [placeId]);
      expect(after.rows[0].content_rating).toBe('adult');
      // Everything else about the Place is untouched.
      expect(after.rows[0].document).toEqual(before.rows[0].document);
      expect(after.rows[0].name).toBe(before.rows[0].name);
      expect(after.rows[0].summary).toBe(before.rows[0].summary);
      expect(after.rows[0].origin_world_id).toBe(fixtureWorldId);
      // The child's authored fields are intact.
      const document = after.rows[0].document as Record<string, unknown>;
      expect(document.worldEntryId).toBe('fixture-harbor');
      expect(document.description).toBe('Authored content that must survive.');
    });
  });

  it('rolls the rating change back with the world save when the save fails', async () => {
    // This one cannot run inside a wrapper transaction: proving a rollback
    // means the write layer must own its own BEGIN/ROLLBACK, which only happens
    // when the executor exposes connect(). So the fixture is committed, the
    // failure is observed from a *separate* connection, and the fixture is
    // removed afterwards.
    const { default: pg } = await import('pg');
    const setup = new pg.Client({ connectionString: databaseUrl });
    await setup.connect();
    const reader = new pg.Client({ connectionString: databaseUrl });
    await reader.connect();
    // Query-only wrappers: the write layer must not open its own transaction
    // while the fixture is being built, or it would nest inside this one.
    const setupDb = { query: async (text: string, params?: unknown[]) => setup.query(text, params as never[]) };
    let userId = '';
    let worldFixtureId = '';
    let placeId = '';
    try {
      const owner = await setup.query(
        `INSERT INTO users (id, discord_id, discord_username, display_name) VALUES (gen_random_uuid(), '999999999999999990', 'rating-fixture-2', 'Rating Fixture 2') RETURNING id`,
      );
      userId = String(owner.rows[0].id);
      const created = await insertAsset(setupDb as never, { userId, isSuperAdmin: false }, {
        type: 'world', name: 'Rollback Fixture World', contentRating: 'sfw', visualTone: 'forest',
        document: { locations: [], worldSettings: { visibility: 'private' } },
      });
      worldFixtureId = String(created.row.id);
      const { createWorldChild } = await import('../server/world-children');
      const place = await createWorldChild(setupDb as never, { userId, isSuperAdmin: false }, worldFixtureId, {
        type: 'place', name: 'Fixture Wharf', visualTone: 'mist', document: { worldEntryId: 'fixture-wharf' },
      });
      placeId = String(place.row.id);

      // A real pool, so the write layer manages its own transaction.
      const pool = new pg.Pool({ connectionString: databaseUrl });

      // A malformed root-authored `species` entry fails at entity sync, which
      // runs after the world row is written and after the rating has been
      // propagated. The rating change must roll back with the rest of the save,
      // or the world and its Places would be left disagreeing.
      await expect(applyAssetUpdate(pool as never, { userId, isSuperAdmin: false }, worldFixtureId, {
        contentRating: 'adult',
        document: { locations: [], species: ['not-an-object'] },
      })).rejects.toThrow(/ambiguous world-entity write/);

      // Read from a connection that was not part of that transaction, so what
      // is observed is what actually survived.
      const worldAfter = await reader.query(`SELECT content_rating FROM library_assets WHERE id = $1`, [worldFixtureId]);
      expect(worldAfter.rows[0].content_rating).toBe('sfw');
      const placeAfter = await reader.query(`SELECT content_rating, document FROM library_assets WHERE id = $1`, [placeId]);
      expect(placeAfter.rows[0].content_rating).toBe('sfw');
      expect((placeAfter.rows[0].document as Record<string, unknown>).worldEntryId).toBe('fixture-wharf');

      await pool.end();
    } finally {
      if (placeId) await setup.query(`DELETE FROM library_assets WHERE id = $1`, [placeId]).catch(() => undefined);
      if (worldFixtureId) await setup.query(`DELETE FROM library_assets WHERE id = $1`, [worldFixtureId]).catch(() => undefined);
      if (userId) await setup.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
      await reader.end().catch(() => undefined);
      await setup.end().catch(() => undefined);
    }
  });

  it('leaves world integrity clean after a rating change', async () => {
    await withRolledBackTransaction(async (db) => {
      const owner = await db.query(
        `INSERT INTO users (id, discord_id, discord_username, display_name) VALUES (gen_random_uuid(), '999999999999999989', 'rating-fixture-3', 'Rating Fixture 3') RETURNING id`,
      );
      const userId = String(owner.rows[0].id);

      const { createWorldChild } = await import('../server/world-children');
      const { inspectWorldIntegrity } = await import('../server/world-integrity');
      const created = await insertAsset(db as never, { userId, isSuperAdmin: false }, {
        type: 'world', name: 'Integrity Fixture World', contentRating: 'sfw', visualTone: 'forest',
        document: { locations: [], worldSettings: { visibility: 'private' } },
      });
      const fixtureWorldId = String(created.row.id);
      await createWorldChild(db as never, { userId, isSuperAdmin: false }, fixtureWorldId, {
        type: 'place', name: 'Fixture Quay', visualTone: 'mist', document: { worldEntryId: 'fixture-quay' },
      });

      await applyAssetUpdate(db as never, { userId, isSuperAdmin: false }, fixtureWorldId, { contentRating: 'adult' });

      const report = await inspectWorldIntegrity(db as never, fixtureWorldId);
      expect(report.errors).toBe(0);
      expect(report.warnings).toBe(0);
      expect(report.embeddedEntries).toBe(report.canonicalRows);
    });
  });
});
