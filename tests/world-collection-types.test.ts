import { describe, expect, it } from 'vitest';
import {
  describeMalformedCollections, findMalformedCollections, rebuildWorldProjection, worldCollectionSpecs,
} from '../server/world-entity-sync';
import { inspectWorldIntegrity } from '../server/world-integrity';
import { removeCanonicalChildrenMissingFromWorld, WorldChildRemovalError } from '../server/world-child-removal';

const worldId = '27d31940-108b-4dde-975d-bd8c1a327f83';
const childId = '0a57d714-3646-468d-9c66-8cf8d406fd22';

/** The defect this guards: a collection present as the JSON string "[]". */
const malformed = {
  identity: { name: 'Eirvargr’s Tribe' },
  locations: [{ id: 'a', name: 'longhouse', libraryAssetId: childId }],
  species: '[]',
  factions: '[]',
  societies: [],
  families: '[]',
  memories: '[]',
};

function executorFor(worldDocument: unknown, rows: unknown[] = []) {
  return {
    query: async (sql: string, params: unknown[]) => {
      if (/type = 'world' AND/.test(sql)) {
        return { rows: [{ id: worldId, name: 'Eirvargr’s Tribe', document: worldDocument }], rowCount: 1 };
      }
      if (/FROM library_assets\s+WHERE origin_world_id/.test(sql)) return { rows, rowCount: rows.length };
      if (/type = 'world' FOR UPDATE/.test(sql)) {
        return { rows: [{ id: worldId, document: worldDocument }], rowCount: 1 };
      }
      if (/SELECT id, type, name, source_type, document/.test(sql)) {
        return { rows: [{ id: childId, type: 'place', name: 'longhouse', source_type: 'user-created', document: { worldEntryId: 'a' } }], rowCount: 1 };
      }
      if (/SELECT/.test(sql)) return { rows: [], rowCount: 0 };
      void params;
      return { rows: [], rowCount: 0 };
    },
  } as never;
}

describe('malformed world collections', () => {
  it('reports present-but-wrongly-typed collections', () => {
    const problems = findMalformedCollections(malformed);
    expect(problems.map((p) => p.key).sort()).toEqual(['factions', 'families', 'memories', 'species']);
    expect(problems.every((p) => p.actual === 'string')).toBe(true);
  });

  it('treats an absent collection as legitimate, not malformed', () => {
    expect(findMalformedCollections({ locations: [], species: [] })).toEqual([]);
  });

  it('accepts a well-formed document', () => {
    const document: Record<string, unknown> = {};
    for (const spec of worldCollectionSpecs) document[spec.key] = [];
    expect(findMalformedCollections(document)).toEqual([]);
  });

  it('describes the type clearly enough to act on', () => {
    expect(describeMalformedCollections(findMalformedCollections(malformed))).toMatch(/species is string, not an array/);
  });

  it('flags a null collection, which is present but unusable', () => {
    expect(findMalformedCollections({ factions: null })).toEqual([{ key: 'factions', actual: 'null' }]);
  });
});

describe('integrity checker', () => {
  it('reports a wrongly typed collection as an error, not as an empty one', async () => {
    const report = await inspectWorldIntegrity(executorFor(malformed, []), undefined);
    const codes = report.issues.filter((i) => i.code === 'malformed_collection_type');
    expect(codes).toHaveLength(4);
    expect(codes.every((issue) => issue.severity === 'error')).toBe(true);
    expect(report.errors).toBeGreaterThanOrEqual(4);
  });

  it('does not then double-report the broken collection as drift', async () => {
    const report = await inspectWorldIntegrity(executorFor(malformed, []), undefined);
    // A string read as [] used to look like "empty" and match zero children. The
    // malformed error must stand alone rather than being padded with phantom drift.
    const forSpecies = report.issues.filter((i) => i.collection === 'species');
    expect(forSpecies.every((issue) => issue.code === 'malformed_collection_type')).toBe(true);
  });

  it('stays clean for a healthy world', async () => {
    const document: Record<string, unknown> = {};
    for (const spec of worldCollectionSpecs) document[spec.key] = [];
    const report = await inspectWorldIntegrity(executorFor(document, []), undefined);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
  });
});

describe('write paths refuse a malformed world instead of overwriting it', () => {
  it('rebuildWorldProjection refuses rather than replacing the bad value with []', async () => {
    await expect(rebuildWorldProjection(executorFor(malformed), worldId, { dropUnlinked: true }))
      .rejects.toThrow(/malformed collections/i);
  });

  it('removeCanonicalChildrenMissingFromWorld refuses BEFORE queueing any deletion', async () => {
    // Valid `before` with one linked child, malformed `after`. Reading `after` as
    // an empty array would present that child as missing and queue it for deletion.
    const before = {
      locations: [{ id: 'a', name: 'longhouse', libraryAssetId: childId }],
      species: [], factions: [], societies: [], families: [], memories: [],
    };
    await expect(removeCanonicalChildrenMissingFromWorld(executorFor(before, []), worldId, before, malformed as never))
      .rejects.toThrow(WorldChildRemovalError);
  });

  it('refuses when the STORED document is malformed', async () => {
    const after: Record<string, unknown> = {};
    for (const spec of worldCollectionSpecs) after[spec.key] = [];
    await expect(removeCanonicalChildrenMissingFromWorld(executorFor(malformed, []), worldId, malformed as never, after as never))
      .rejects.toThrow(WorldChildRemovalError);
  });
});
