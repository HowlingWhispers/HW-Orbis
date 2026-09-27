import { describe, expect, it } from 'vitest';
import {
  assertNoMinorSexualContent, buildCodaOutcomeSummary, buildCodaWriteReport, CodaRuntimeError,
  executeCodaOperations, mergeCodaDocumentPatch, stripWriteClaims, validateCodaOperation, validateCodaOperations,
  type CodaExecutorIdentity,
} from '../server/coda-runtime';
import type { DatabasePool } from '../server/db';

const identity: CodaExecutorIdentity = { userId: 'user-1', isSuperAdmin: false, canCreate: true, canViewAdult: true };
const worldId = '11111111-1111-4111-8111-111111111111';
const recordId = '22222222-2222-4222-8222-222222222222';

function fakePool() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  let insertCount = 0;
  let revisionSeq = 0;
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT max(revision)')) return { rows: [{ revision: revisionSeq }], rowCount: 1 };
      if (sql.includes('INSERT INTO library_asset_revisions')) { revisionSeq += 1; return { rows: [], rowCount: 1 }; }
      if (sql.startsWith('SELECT * FROM library_assets WHERE id = $1')) {
        return { rows: [{ id: recordId, type: 'character', name: 'Existing', summary: '', origin_world_id: worldId, creator_user_id: 'user-1', content_rating: 'sfw', tags: [], visual_tone: 'moon', document: { lore: 'old' }, updated_at: new Date('2026-01-01T00:00:00Z') }], rowCount: 1 };
      }
      if (sql.includes('SELECT id, type, creator_user_id FROM library_assets WHERE id = $1')) {
        return { rows: [{ id: worldId, type: 'world', creator_user_id: 'user-1' }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO library_assets')) {
        insertCount += 1;
        return { rows: [{ id: recordId, type: params?.[1], name: params?.[2], content_rating: params?.[6], origin_world_id: params?.[4], document: JSON.parse(String(params?.[9])), updated_at: new Date('2026-02-02T00:00:00Z') }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE library_assets')) {
        return { rows: [{ id: recordId, type: 'character', name: params?.[1], summary: params?.[2], origin_world_id: params?.[3], content_rating: params?.[4], tags: params?.[5], visual_tone: params?.[6], document: JSON.parse(String(params?.[7])), updated_at: new Date('2026-02-02T00:00:00Z') }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as DatabasePool;
  return { pool, queries, insertCount: () => insertCount };
}

function canonicalPlacePool() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  let revision = 0;
  let child: Record<string, unknown> | undefined;
  const parent: Record<string, unknown> = {
    id: '33333333-3333-4333-8333-333333333333', type: 'place', name: 'Ridge', summary: '',
    origin_world_id: worldId, creator_user_id: identity.userId, content_rating: 'sfw', tags: [], visual_tone: 'mist',
    document: { worldEntryId: 'ridge', kind: 'region' }, updated_at: new Date('2026-01-01T00:00:00Z'),
  };
  let worldDocument: Record<string, unknown> = { lore: 'kept', locations: [] };
  let failCanonicalUpdate = false;
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("SELECT id FROM library_assets WHERE id = $1 AND type = 'world' FOR UPDATE")) return { rows: [{ id: worldId }], rowCount: 1 };
      if (sql.includes('SELECT id, type, creator_user_id FROM library_assets')) return { rows: [{ id: worldId, type: 'world', creator_user_id: identity.userId }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO library_assets')) {
        child = {
          id: params?.[0], type: params?.[1], name: params?.[2], summary: params?.[3], origin_world_id: params?.[4],
          creator_user_id: identity.userId, content_rating: params?.[6], tags: params?.[7], visual_tone: params?.[8],
          document: JSON.parse(String(params?.[9])), updated_at: new Date('2026-02-02T00:00:00Z'),
        };
        return { rows: [child], rowCount: 1 };
      }
      if (sql.includes('SELECT max(revision)')) return { rows: [{ revision }], rowCount: 1 };
      if (sql.includes('INSERT INTO library_asset_revisions')) { revision += 1; return { rows: [], rowCount: 1 }; }
      if (sql.startsWith('SELECT * FROM library_assets WHERE id = $1')) {
        const row = params?.[0] === child?.id ? child : undefined;
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes("WHERE id = $1 OR (origin_world_id = $2 AND type = 'place'")) {
        return params?.[0] === 'ridge' ? { rows: [parent], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("WHERE origin_world_id = $1 AND type = 'place'")) return { rows: [parent, ...(child ? [child] : [])], rowCount: child ? 2 : 1 };
      if (sql.startsWith('UPDATE library_assets SET name=$2')) {
        if (failCanonicalUpdate) throw new Error('simulated canonical failure');
        child = {
          ...child, name: params?.[1], summary: params?.[2], origin_world_id: params?.[3], content_rating: params?.[4],
          tags: params?.[5], visual_tone: params?.[6], document: JSON.parse(String(params?.[7])), updated_at: new Date('2026-03-03T00:00:00Z'),
        };
        return { rows: [child], rowCount: 1 };
      }
      if (sql.includes("SELECT document FROM library_assets WHERE id = $1 AND type = 'world' FOR UPDATE")) return { rows: [{ document: worldDocument }], rowCount: 1 };
      if (sql.includes('SET document = $2::jsonb, updated_at = now() WHERE id = $1')) {
        worldDocument = JSON.parse(String(params?.[1]));
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE library_assets')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as DatabasePool;
  return {
    pool, queries,
    child: () => child,
    worldDocument: () => worldDocument,
    failCanonicalUpdates: () => { failCanonicalUpdate = true; },
  };
}

describe('Coda runtime validation', () => {
  it('rejects a malformed operation instead of pretending it ran', () => {
    expect(() => validateCodaOperation({ op: 'create', name: 'X' }, 0, identity)).toThrow(/record type/);
    expect(() => validateCodaOperation({ op: 'create', type: 'character' }, 0, identity)).toThrow(/names no record/);
    expect(() => validateCodaOperation({ op: 'update', name: 'X' }, 0, identity)).toThrow(/target record ID/);
    expect(() => validateCodaOperation({ op: 'create', type: 'character', name: 'X', unexpected: true }, 0, identity)).toThrow(CodaRuntimeError);
    expect(() => validateCodaOperations({ operations: 'not-an-array' }, identity)).toThrow(/malformed operation set/);
    expect(() => validateCodaOperations({ operations: [] }, identity)).toThrow(/no executable operations/);
  });

  it('refuses control fields Coda may never set', () => {
    expect(() => validateCodaOperation({ op: 'create', type: 'character', name: 'X', fields: { creatorUserId: 'someone' } }, 0, identity)).toThrow(/control fields/);
    expect(() => validateCodaOperation({ op: 'create', type: 'character', name: 'X', fields: { nested: { visibility: 'public' } } }, 0, identity)).toThrow(/control fields/);
    expect(() => validateCodaOperation({ op: 'create', type: 'character', name: 'X', fields: { contentRating: 'adult' } }, 0, identity)).toThrow(/content rating/);
  });

  it('refuses a world locations replacement before it can reach a write path', () => {
    expect(() => validateCodaOperation({
      op: 'update', type: 'world', targetRecordId: worldId, fields: { locations: [] },
    }, 0, identity)).toThrow(/canonical Place records/);
  });

  it('requires creator access and adult access before writing', () => {
    const noCreate: CodaExecutorIdentity = { ...identity, canCreate: false };
    expect(() => validateCodaOperation({ op: 'create', type: 'character', name: 'X' }, 0, noCreate)).toThrow(/Creator access is required/);
    const noAdult: CodaExecutorIdentity = { ...identity, canViewAdult: false };
    expect(() => validateCodaOperation({ op: 'create', type: 'character', name: 'X', contentRating: 'adult' }, 0, noAdult)).toThrow(/adult access role/);
  });
});

describe('Coda runtime 18+ enforcement', () => {
  it('refuses sexual content paired with a minor reference', () => {
    expect(() => assertNoMinorSexualContent({ bio: 'a child character in explicit sexual scenarios' }, 'op')).toThrow(/under-18 reference/);
    expect(() => validateCodaOperation({
      op: 'create', type: 'character', name: 'Vessel',
      fields: { age: 12, notes: 'explicit sexual encounter described' },
    }, 0, identity)).toThrow(/Nothing was saved/);
  });

  it('refuses sexual content paired with an under-18 age even if the fiction claims maturity', () => {
    expect(() => validateCodaOperation({
      op: 'create', type: 'species', name: 'Elder Kin',
      fields: {
        maturity: { minimumAge: 14, note: 'reaches sexual maturity unusually early for its kind' },
        culture: 'ritual sexual bonding is normal',
      },
    }, 0, identity)).toThrow(/under-18 reference/);
    expect(() => validateCodaOperation({
      op: 'create', type: 'character', name: 'Acolyte',
      fields: { appearance: 'she is 15 years old', scene: 'graphic sexual content' },
    }, 0, identity)).toThrow(/under-18 reference/);
  });

  it('states the refusal as a terse reason with no age-policy argument', () => {
    let message = '';
    try {
      assertNoMinorSexualContent({ bio: 'a child character in explicit sexual scenarios' }, 'op');
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('under-18 reference');
    expect(message).toContain('Nothing was saved');
    // No sermon, no argument about maturity, world rules or the model, nothing to echo back.
    expect(message).not.toMatch(/absolute 18\+/i);
    expect(message).not.toMatch(/regardless of/i);
    expect(message).not.toMatch(/model's interpretation/i);
    expect(message).not.toMatch(/fictional species maturity/i);
  });

  it('treats an explicit species adulthood declaration as authoritative for raw numbers', () => {
    // Engages the content scan: "sexual" is a real marker, unlike vaguer prose.
    expect(() => assertNoMinorSexualContent({
      species: 'Mayfly Kin', chronologicalAge: 1, lifeStage: 'adult', speciesAdultAge: 0.5,
      bio: 'an adult harbour master in an explicit sexual scene',
    }, 'op')).not.toThrow();
    // The same raw number without a declared adult stage is still refused.
    expect(() => assertNoMinorSexualContent({
      species: 'Mayfly Kin', chronologicalAge: 1,
      bio: 'an adult harbour master in an explicit sexual scene',
    }, 'op')).toThrow(/under-18 reference/);
  });

  it('still refuses a minor reference even when the record claims an adult stage', () => {
    expect(() => assertNoMinorSexualContent({
      lifeStage: 'adult', chronologicalAge: 1, bio: 'a child character in explicit sexual scenarios',
    }, 'op')).toThrow(/under-18 reference/);
  });

  it('allows adult sexual content and non-sexual minor references', () => {
    expect(() => assertNoMinorSexualContent({ bio: 'two adult characters, consenting, explicit' }, 'op')).not.toThrow();
    expect(() => assertNoMinorSexualContent({ bio: 'a village where children learn crafts' }, 'op')).not.toThrow();
    expect(() => validateCodaOperation({
      op: 'create', type: 'character', name: 'Adult Weaver', fields: { age: 34, notes: 'explicit scene with an adult partner' },
    }, 0, identity)).not.toThrow();
  });
});

describe('Coda runtime batch isolation', () => {
  it('reports a refused operation as a structured result and still applies its siblings', async () => {
    const { pool } = fakePool();
    const results = await executeCodaOperations(pool, identity, {
      operations: [
        { op: 'create', type: 'character', name: 'Refused', fields: { age: 12, notes: 'explicit sexual encounter described' } },
        { op: 'create', type: 'character', name: 'Allowed', fields: { age: 34 } },
      ],
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe('rejected');
    expect(results[0]?.code).toBe('minor_sexual_content');
    expect(results[0]?.index).toBe(0);
    expect(results[0]?.revision).toBeNull();
    expect(results[1]?.status).toBe('applied');
    expect(results[1]?.index).toBe(1);
  });

  it('never throws for a runtime refusal and keeps ordering stable', async () => {
    const { pool } = fakePool();
    const results = await executeCodaOperations(pool, identity, {
      operations: [
        { op: 'create', type: 'character', name: 'A', fields: { age: 30 } },
        { op: 'create', type: 'character', name: 'B', fields: { age: 11, notes: 'explicit scene' } },
        { op: 'create', type: 'character', name: 'C', fields: { age: 40 } },
      ],
    });
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.status)).toEqual(['applied', 'rejected', 'applied']);
  });

  it('surfaces a refused operation through the normal write report, not as a crash', async () => {
    const { pool } = fakePool();
    const results = await executeCodaOperations(pool, identity, {
      operations: [{ op: 'create', type: 'character', name: 'Refused', fields: { age: 12, notes: 'explicit sexual scene' } }],
    });
    const report = buildCodaWriteReport(results);
    expect(report).toContain('NOT SAVED');
    expect(report).not.toMatch(/absolute 18\+/i);
    expect(buildCodaOutcomeSummary(results, 0)).toBe('Orbis saved nothing. 1 operation failed.');
  });

  it('still refuses an entirely unusable batch', async () => {
    const { pool } = fakePool();
    await expect(executeCodaOperations(pool, identity, { operations: [] }, {}))
      .rejects.toThrow(/no executable operations/);
  });
});

describe('Coda runtime execution', () => {
  it('performs a real create and returns a confirmed revision', async () => {
    const { pool, queries } = fakePool();
    const results = await executeCodaOperations(pool, identity, {
      operations: [{ op: 'create', type: 'character', name: 'Ashen Cartographer', fields: { lore: 'maps the burn' } }],
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'applied', operation: 'create', recordType: 'character', revision: 1 });
    expect(results[0].message).toContain('revision 1');
    expect(queries.some((query) => query.sql.includes('INSERT INTO library_assets'))).toBe(true);
    expect(queries.some((query) => query.sql.includes('INSERT INTO library_asset_revisions'))).toBe(true);
  });

  it('creates, edits, and moves a Place through canonical child writes and equivalent projection shape', async () => {
    const fixture = canonicalPlacePool();
    const created = await executeCodaOperations(fixture.pool, identity, {
      operations: [{ op: 'create', type: 'place', name: 'Harbor', fields: { kind: 'settlement', description: 'Old', authored: { keeper: true } } }],
    }, { defaultOriginWorldId: worldId });
    expect(created[0]).toMatchObject({ status: 'applied', recordType: 'place', originWorldId: worldId });
    expect(fixture.queries.some(({ sql }) => sql.startsWith('INSERT INTO library_assets'))).toBe(true);

    const childId = String(created[0].recordId);
    const updated = await executeCodaOperations(fixture.pool, identity, {
      operations: [{ op: 'update', targetRecordId: childId, fields: { description: 'New', parentLocationId: 'ridge' } }],
    });
    expect(updated[0]).toMatchObject({ status: 'applied', operation: 'update' });
    expect(fixture.child()?.document).toMatchObject({ kind: 'settlement', description: 'New', authored: { keeper: true }, parentLocationId: 'ridge' });
    const projected = (fixture.worldDocument().locations as Record<string, unknown>[])[0];
    expect(projected).toMatchObject({
      id: (fixture.child()?.document as Record<string, unknown>).worldEntryId,
      libraryAssetId: childId,
      name: 'Harbor',
      kind: 'settlement',
      description: 'New',
      parentLocationId: 'ridge',
    });
    expect(fixture.queries.some(({ sql }) => sql.startsWith('UPDATE library_assets SET name=$2'))).toBe(true);
  });

  it('does not touch the world projection when the canonical Place write fails', async () => {
    const fixture = canonicalPlacePool();
    const created = await executeCodaOperations(fixture.pool, identity, {
      operations: [{ op: 'create', type: 'place', name: 'Harbor', fields: { description: 'Old' } }],
    }, { defaultOriginWorldId: worldId });
    const projectionBefore = structuredClone(fixture.worldDocument());
    fixture.failCanonicalUpdates();
    const worldProjectionWritesBefore = fixture.queries.filter(({ sql }) => sql.includes('SET document = $2::jsonb, updated_at = now() WHERE id = $1')).length;
    const failed = await executeCodaOperations(fixture.pool, identity, {
      operations: [{ op: 'update', targetRecordId: created[0].recordId, fields: { description: 'Never projected' } }],
    });
    expect(failed[0]?.status).toBe('failed');
    expect(fixture.worldDocument()).toEqual(projectionBefore);
    expect(fixture.queries.filter(({ sql }) => sql.includes('SET document = $2::jsonb, updated_at = now() WHERE id = $1'))).toHaveLength(worldProjectionWritesBefore);
  });

  it('performs a real update and reports the changed fields', async () => {
    const { pool, queries } = fakePool();
    const results = await executeCodaOperations(pool, identity, {
      operations: [{ op: 'update', targetRecordId: recordId, fields: { lore: 'maps the ash seas' } }],
    });
    expect(results[0]).toMatchObject({ status: 'applied', operation: 'update', recordId });
    expect(results[0].changedFields).toContain('document');
    expect(queries.some((query) => query.sql.startsWith('UPDATE library_assets'))).toBe(true);
  });

  it('merges a Place patch without erasing authored sibling fields', () => {
    expect(mergeCodaDocumentPatch({
      description: 'Old', kind: 'settlement', authored: { keeper: true, note: 'old' },
    }, {
      description: 'New', authored: { note: 'new' }, parentLocationId: 'ridge',
    })).toEqual({
      description: 'New', kind: 'settlement', authored: { keeper: true, note: 'new' }, parentLocationId: 'ridge',
    });
  });

  it('rejects locations against the stored world type even when the operation omits type', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith('SELECT * FROM library_assets')) {
          return { rowCount: 1, rows: [{ id: worldId, type: 'world', document: { locations: [] } }] };
        }
        throw new Error('unexpected write');
      },
    } as unknown as DatabasePool;
    const results = await executeCodaOperations(pool, identity, {
      operations: [{ op: 'update', targetRecordId: worldId, fields: { locations: [{ name: 'Injected' }] } }],
    });
    expect(results[0]).toMatchObject({ status: 'rejected', code: 'embedded_locations_forbidden' });
    expect(queries.some((sql) => sql.startsWith('UPDATE') || sql.startsWith('INSERT'))).toBe(false);
  });

  it('reports failure honestly and never claims a save when the write is rejected', async () => {
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as DatabasePool;
    const results = await executeCodaOperations(pool, identity, {
      operations: [{ op: 'update', targetRecordId: '33333333-3333-4333-8333-333333333333', fields: { lore: 'x' } }],
    });
    expect(results[0].status).toBe('failed');
    expect(results[0].recordId).toBe('33333333-3333-4333-8333-333333333333');
    expect(results[0].revision).toBeNull();
    expect(results[0].message).toMatch(/^Nothing was saved/);
    expect(buildCodaWriteReport(results)).toMatch(/Orbis applied none of the operations\. Nothing was saved\./);
    expect(buildCodaOutcomeSummary(results, 0)).toMatch(/Orbis saved nothing/);
  });

  it('keeps a refused operation away from the database without aborting the batch', async () => {
    const { pool, queries, insertCount } = fakePool();
    const results = await executeCodaOperations(pool, identity, {
      operations: [
        { op: 'create', type: 'character', name: 'Bad', fields: { contentRating: 'adult' } },
        { op: 'create', type: 'character', name: 'Good', fields: { age: 30 } },
      ],
    });
    expect(results[0]?.status).toBe('rejected');
    expect(results[0]?.code).toBe('protected_field');
    expect(results[1]?.status).toBe('applied');
    // The refused operation itself still never reaches the database.
    expect(insertCount()).toBe(1);
    expect(queries.filter((query) => query.sql.includes('INSERT INTO library_assets'))).toHaveLength(1);
    const inserted = queries.filter((query) => query.sql.startsWith('INSERT INTO library_assets'));
    expect(inserted.every((query) => !JSON.stringify(query.params).includes('Bad'))).toBe(true);
  });

  it('builds a report that only reflects confirmed writes', () => {
    const results = [
      { index: 0, status: 'applied' as const, operation: 'create' as const, requestedName: 'A', recordId: 'r1', recordType: 'world', revision: 1, changedFields: ['document'], originWorldId: null, contentRating: 'sfw', message: 'Created world "A" as record r1 (revision 1).' },
      { index: 1, status: 'failed' as const, operation: 'create' as const, requestedName: 'B', recordId: null, recordType: 'place', revision: null, changedFields: [], originWorldId: null, contentRating: 'sfw', message: 'Nothing was saved for "B": Record not found.' },
    ];
    const report = buildCodaWriteReport(results);
    expect(report).toContain('Orbis applied 1 of 2 operation(s).');
    expect(report).toContain('SAVED — Created world "A"');
    expect(report).toContain('NOT SAVED — Nothing was saved for "B"');
    expect(buildCodaOutcomeSummary(results, 0)).toBe('Orbis saved 1 of 2 operations; 1 failed and nothing was saved for those.');
    expect(buildCodaOutcomeSummary([], 3)).toMatch(/Nothing has been saved yet/);
  });
});

describe('Coda write-claim guard', () => {
  it('rewrites a narration that claims a completed write', () => {
    const result = stripWriteClaims('I created the faction and saved the world, then updated the place.');
    expect(result.rewritten).toBe(true);
    expect(result.text).not.toMatch(/\b(created|saved|updated)\b/);
    expect(result.text).toContain('drafted');
  });

  it('leaves honest narration alone', () => {
    const result = stripWriteClaims('Here is a draft of the faction. Nothing is written yet.');
    expect(result.rewritten).toBe(false);
    expect(result.text).toBe('Here is a draft of the faction. Nothing is written yet.');
  });
});
