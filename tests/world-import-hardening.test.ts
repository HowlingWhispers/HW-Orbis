// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertWorldDocumentCollections, AssetWriteError } from '../server/asset-writes';
import { inspectWorldIntegrity } from '../server/world-integrity';

const repoRoot = join(import.meta.dirname, '..');

/*
 * Behaviour that needs a database runs against a real Orbis database inside a
 * transaction that is always rolled back, so nothing is persisted. `pg.Client`
 * exposes .connect(), which the write layer would use to open its own
 * transaction; wrapping it hides that method and keeps this test in charge of
 * BEGIN/ROLLBACK. These tests skip when DATABASE_URL is not set.
 */
const databaseUrl = process.env.DATABASE_URL;
const live = databaseUrl ? describe.sequential : describe.skip;

function sampleBundle() {
  return {
    format: 'howling_whispers_private_place_bundle',
    place: {
      name: 'Hardening Fixture Tribe',
      type: 'village',
      description: 'A throwaway world used only inside a rolled-back transaction.',
      core_locations: {
        longhouse: { name: 'Fixture Longhouse', summary: 'Where the kin gather.', kind: 'structure' },
        'healers-hut': { name: 'Fixture Healer Hut', summary: 'Bitterroot and poultices.', kind: 'structure' },
      },
      species: {
        foxkin: { name: 'Fixture Foxkin', summary: 'Clever and quick.' },
        coyotekin: { name: 'Fixture Coyotekin', summary: 'Patient hunters.' },
      },
      society: { tribe: { name: 'Fixture Society', summary: 'The kin that holds the delta.' } },
    },
  };
}

type TestDb = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

async function withRolledBackTransaction<T>(work: (db: TestDb) => Promise<T>): Promise<T> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    // Hide .connect() so the production code joins our transaction instead of
    // opening (and committing) its own.
    const db = {
      query: async (text: string, params?: unknown[]) => {
        try {
          return await client.query(text, params as never[]);
        } catch (error) {
          // The sync layer deliberately collects per-item errors, which can mask
          // the statement that actually failed. Attach it so a rolled-back unit is
          // diagnosable from the test output.
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

describe('world collection validation at the write boundary', () => {
  it('rejects a collection given as the JSON string "[]"', () => {
    expect(() => assertWorldDocumentCollections('world', { factions: '[]' })).toThrow(AssetWriteError);
  });

  it('explains which collection is wrong and what it received', () => {
    let message = '';
    try { assertWorldDocumentCollections('world', { factions: '[]', memories: '[]' }); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/factions is string, not an array/);
    expect(message).toMatch(/memories is string, not an array/);
    expect(message).toMatch(/Orbis will not guess/);
  });

  it('uses a 400 so the API reports a structural problem, not a server fault', () => {
    try { assertWorldDocumentCollections('world', { species: '[]' }); } catch (error) {
      expect((error as AssetWriteError).status).toBe(400);
    }
  });

  it('accepts a real array', () => {
    expect(() => assertWorldDocumentCollections('world', { factions: [], species: [{ name: 'Foxkin' }] })).not.toThrow();
  });

  it('accepts an omitted optional collection', () => {
    expect(() => assertWorldDocumentCollections('world', { locations: [] })).not.toThrow();
    expect(() => assertWorldDocumentCollections('world', {})).not.toThrow();
  });

  it('does not apply the rule to non-world records', () => {
    expect(() => assertWorldDocumentCollections('place', { locations: '[]' })).not.toThrow();
  });

  it('never coerces the bad value into an array', () => {
    const document = { factions: '[]' };
    try { assertWorldDocumentCollections('world', document); } catch { /* expected */ }
    expect(document.factions).toBe('[]');
  });
});

describe('no importer may replace a world document wholesale', () => {
  const sources = readdirSync(join(repoRoot, 'server'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join('server', name));

  it('finds no destructive ON CONFLICT ... document = EXCLUDED.document', () => {
    const offenders: string[] = [];
    for (const relative of [...sources, 'import-place-bundle.mjs', 'migrate-world-locations.mjs']) {
      const contents = readFileSync(join(repoRoot, relative), 'utf8');
      if (/document\s*=\s*EXCLUDED\.document/i.test(contents)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });

  it('has retired the SQL migration that copied three fields and swallowed errors', () => {
    const sql = readFileSync(join(repoRoot, 'migrate-world-locations.sql'), 'utf8');
    expect(sql).toMatch(/RETIRED/);
    expect(sql).not.toMatch(/EXCLUDED\.document/);
  });
});

live('place bundle import', () => {
  it('creates canonical children and projects every one of them', async () => {
    const { importPlaceBundle } = await import('../server/import-place-bundle');
    await withRolledBackTransaction(async (db) => {
      const owner = await db.query(
        `INSERT INTO users (id, discord_id, discord_username, display_name)
         VALUES (gen_random_uuid(), '999999999999999999', 'hardening-fixture', 'Hardening Fixture') RETURNING id`,
      );
      const userId = String(owner.rows[0].id);
      const result = await importPlaceBundle(db as never, sampleBundle(), { userId });

      expect(result.worldCreated).toBe(true);
      expect(result.childrenCreated).toBe(5);

      const children = await db.query(
        `SELECT type, name, origin_world_id FROM library_assets WHERE origin_world_id = $1 ORDER BY type, name`, [result.worldId]);
      expect(children.rows).toHaveLength(5);
      expect(children.rows.every((row: { origin_world_id: unknown }) => row.origin_world_id === result.worldId)).toBe(true);

      const world = await db.query(`SELECT document, dependency_count FROM library_assets WHERE id = $1`, [result.worldId]);
      const document = world.rows[0].document as Record<string, unknown[]>;
      expect(document.locations).toHaveLength(2);
      expect(document.species).toHaveLength(2);
      expect(document.societies).toHaveLength(1);
      for (const key of ['locations', 'species', 'societies', 'factions', 'families', 'memories']) {
        expect(Array.isArray(document[key])).toBe(true);
      }
      for (const entry of [...document.locations, ...document.species, ...document.societies]) {
        expect((entry as Record<string, unknown>).libraryAssetId).toBeTruthy();
        expect((entry as Record<string, unknown>).id).toBeTruthy();
      }
      expect(Number(world.rows[0].dependency_count)).toBe(5);
    });
  });

  it('is idempotent: a re-run creates nothing and erases no link', async () => {
    const { importPlaceBundle } = await import('../server/import-place-bundle');
    await withRolledBackTransaction(async (db) => {
      const owner = await db.query(
        `INSERT INTO users (id, discord_id, discord_username, display_name) VALUES (gen_random_uuid(), '999999999999999998', 'hardening-fixture', 'Hardening Fixture 2') RETURNING id`,
      );
      const userId = String(owner.rows[0].id);

      const first = await importPlaceBundle(db as never, sampleBundle(), { userId });
      const before = await db.query(`SELECT document FROM library_assets WHERE id = $1`, [first.worldId]);
      const links = (before.rows[0].document as Record<string, unknown[]>).locations
        .map((entry) => (entry as Record<string, unknown>).libraryAssetId);

      const second = await importPlaceBundle(db as never, sampleBundle(), { userId });

      expect(second.worldCreated).toBe(false);
      expect(second.childrenCreated).toBe(0);
      expect(second.childrenExisting).toBe(5);

      const children = await db.query(`SELECT count(*)::int AS n FROM library_assets WHERE origin_world_id = $1`, [first.worldId]);
      expect(Number(children.rows[0].n)).toBe(5);

      const after = await db.query(`SELECT document FROM library_assets WHERE id = $1`, [first.worldId]);
      const afterLinks = (after.rows[0].document as Record<string, unknown[]>).locations
        .map((entry) => (entry as Record<string, unknown>).libraryAssetId);
      expect(afterLinks).toEqual(links);
    });
  });

  it('keeps newer authored world state across a re-run', async () => {
    const { importPlaceBundle } = await import('../server/import-place-bundle');
    await withRolledBackTransaction(async (db) => {
      const owner = await db.query(
        `INSERT INTO users (id, discord_id, discord_username, display_name) VALUES (gen_random_uuid(), '999999999999999997', 'hardening-fixture', 'Hardening Fixture 3') RETURNING id`,
      );
      const userId = String(owner.rows[0].id);
      const first = await importPlaceBundle(db as never, sampleBundle(), { userId });

      await db.query(
        `UPDATE library_assets SET document = jsonb_set(document, '{lore}', '"authored after the import"'::jsonb, true)
         WHERE id = $1`, [first.worldId]);

      await importPlaceBundle(db as never, sampleBundle(), { userId });

      const after = await db.query(`SELECT document->'lore' AS lore FROM library_assets WHERE id = $1`, [first.worldId]);
      expect(after.rows[0].lore).toBe('authored after the import');
    });
  });

  it('leaves integrity at zero errors and zero warnings', async () => {
    const { importPlaceBundle } = await import('../server/import-place-bundle');
    await withRolledBackTransaction(async (db) => {
      const owner = await db.query(
        `INSERT INTO users (id, discord_id, discord_username, display_name) VALUES (gen_random_uuid(), '999999999999999996', 'hardening-fixture', 'Hardening Fixture 4') RETURNING id`,
      );
      const userId = String(owner.rows[0].id);
      const result = await importPlaceBundle(db as never, sampleBundle(), { userId });

      const report = await inspectWorldIntegrity(db as never, result.worldId);
      expect(report.errors).toBe(0);
      expect(report.warnings).toBe(0);
      expect(report.embeddedEntries).toBe(report.canonicalRows);
    });
  });
});

live('world location migration', () => {
  async function seedWorld(db: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, locations: unknown, discordId: string) {
    const inserted = await db.query(
      `INSERT INTO library_assets (id, type, name, summary, origin_world_id, creator_user_id, source_type, content_rating, tags, visual_tone, document)
       VALUES (gen_random_uuid(), 'world', $1, '', NULL, (SELECT id FROM users WHERE discord_id = $2), 'user-created', 'sfw', '{}', 'forest', $3::jsonb)
       RETURNING id`,
      ['Migration Fixture World', discordId, JSON.stringify({ locations })],
    );
    return String((inserted as { rows: Array<{ id: string }> }).rows[0].id);
  }

  it('links embedded locations to canonical place rows and keeps authored fields', async () => {
    const { migrateWorldLocations } = await import('../server/migrate-world-locations');
    await withRolledBackTransaction(async (db) => {
      await db.query(`INSERT INTO users (id, discord_id, discord_username, display_name) VALUES (gen_random_uuid(), '999999999999999995', 'hardening-fixture', 'Migration Fixture')`);
      const worldId = await seedWorld(db, [
        { id: 'fixture-longhouse', name: 'Fixture Longhouse', description: 'Gathering.', kind: 'structure', atmosphere: 'smoke' },
        { id: 'fixture-hut', name: 'Fixture Hut', description: 'Bitterroot.', kind: 'structure' },
      ], '999999999999999995');

      const result = await migrateWorldLocations(db as never, worldId, {});
      expect(result.errors).toEqual([]);
      expect(result.created).toBe(2);

      const places = await db.query(
        `SELECT name, document FROM library_assets WHERE origin_world_id = $1 AND type = 'place' ORDER BY name`, [worldId]);
      expect(places.rows).toHaveLength(2);
      const longhouse = places.rows.find((row: { name: string }) => row.name === 'Fixture Longhouse');
      expect((longhouse.document as Record<string, unknown>).kind).toBe('structure');
      expect((longhouse.document as Record<string, unknown>).atmosphere).toBe('smoke');
      expect((longhouse.document as Record<string, unknown>).worldEntryId).toBe('fixture-longhouse');

      const world = await db.query(`SELECT document FROM library_assets WHERE id = $1`, [worldId]);
      const locations = (world.rows[0] as { document: Record<string, unknown[]> }).document.locations;
      expect(locations).toHaveLength(2);
      for (const entry of locations) expect((entry as Record<string, unknown>).libraryAssetId).toBeTruthy();
    });
  });

  it('is idempotent and never duplicates a location', async () => {
    const { migrateWorldLocations } = await import('../server/migrate-world-locations');
    await withRolledBackTransaction(async (db) => {
      await db.query(`INSERT INTO users (id, discord_id, discord_username, display_name) VALUES (gen_random_uuid(), '999999999999999994', 'hardening-fixture', 'Migration Fixture 2')`);
      const worldId = await seedWorld(db, [{ id: 'fixture-a', name: 'Fixture A', description: 'One.' }], '999999999999999994');

      const first = await migrateWorldLocations(db as never, worldId, {});
      expect(first.errors).toEqual([]);
      const second = await migrateWorldLocations(db as never, worldId, {});
      expect(second.errors).toEqual([]);

      expect(first.created).toBe(1);
      expect(second.created).toBe(0);
      expect(second.alreadyLinked).toBe(1);
      const places = await db.query(`SELECT count(*)::int AS n FROM library_assets WHERE origin_world_id = $1 AND type = 'place'`, [worldId]);
      expect(Number(places.rows[0].n)).toBe(1);
    });
  });

  it('reports a non-array locations value rather than skipping the world', async () => {
    const { migrateWorldLocations } = await import('../server/migrate-world-locations');
    await withRolledBackTransaction(async (db) => {
      await db.query(`INSERT INTO users (id, discord_id, discord_username, display_name) VALUES (gen_random_uuid(), '999999999999999993', 'hardening-fixture', 'Migration Fixture 3')`);
      const worldId = await seedWorld(db, '[]', '999999999999999993');
      const result = await migrateWorldLocations(db as never, worldId, {});
      expect(result.errors[0]).toMatch(/not a list/);
    });
  });

  it('cannot leave an orphan when the projection step fails', async () => {
    const { migrateWorldLocations } = await import('../server/migrate-world-locations');
    await withRolledBackTransaction(async (db) => {
      await db.query(`INSERT INTO users (id, discord_id, discord_username, display_name) VALUES (gen_random_uuid(), '999999999999999992', 'hardening-fixture', 'Migration Fixture 4')`);
      const worldId = await seedWorld(db, [{ id: 'fixture-a', name: 'Fixture A', description: 'One.' }], '999999999999999992');

      // Make the world-document write fail after the place row exists. The whole
      // unit must abort, so nothing survives the rollback.
      const original = db.query.bind(db);
      const sabotaged: TestDb = {
        query: async (sql: string, params?: unknown[]) => {
          if (/UPDATE library_assets/i.test(sql) && /jsonb_set|document/i.test(sql) && !/dependency_count/i.test(sql)) {
            throw new Error('simulated back-link failure');
          }
          return original(sql, params);
        },
      };

      await expect(migrateWorldLocations(sabotaged as never, worldId, {})).rejects.toThrow('simulated back-link failure');
    });

    // Prove the abandoned unit left nothing behind: a fresh connection sees no
    // fixture rows at all, because the transaction that created them rolled back.
    const { default: pg } = await import('pg');
    const check = new pg.Client({ connectionString: databaseUrl });
    await check.connect();
    try {
      const leftover = await check.query(`SELECT count(*)::int AS n FROM library_assets WHERE name LIKE 'Fixture %'`);
      expect(Number(leftover.rows[0].n)).toBe(0);
    } finally {
      await check.end();
    }
  });
});
