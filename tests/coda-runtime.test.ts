import { describe, expect, it } from 'vitest';
import {
  assertNoMinorSexualContent, buildCodaOutcomeSummary, buildCodaWriteReport, CodaRuntimeError,
  executeCodaOperations, stripWriteClaims, validateCodaOperation, validateCodaOperations,
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

  it('requires creator access and adult access before writing', () => {
    const noCreate: CodaExecutorIdentity = { ...identity, canCreate: false };
    expect(() => validateCodaOperation({ op: 'create', type: 'character', name: 'X' }, 0, noCreate)).toThrow(/Creator access is required/);
    const noAdult: CodaExecutorIdentity = { ...identity, canViewAdult: false };
    expect(() => validateCodaOperation({ op: 'create', type: 'character', name: 'X', contentRating: 'adult' }, 0, noAdult)).toThrow(/adult access role/);
  });
});

describe('Coda runtime 18+ enforcement', () => {
  it('refuses sexual content paired with a minor reference', () => {
    expect(() => assertNoMinorSexualContent({ bio: 'a child character in explicit sexual scenarios' }, 'op')).toThrow(/absolute 18\+/);
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
    }, 0, identity)).toThrow(/absolute 18\+/);
    expect(() => validateCodaOperation({
      op: 'create', type: 'character', name: 'Acolyte',
      fields: { appearance: 'she is 15 years old', scene: 'graphic sexual content' },
    }, 0, identity)).toThrow(/absolute 18\+/);
  });

  it('allows adult sexual content and non-sexual minor references', () => {
    expect(() => assertNoMinorSexualContent({ bio: 'two adult characters, consenting, explicit' }, 'op')).not.toThrow();
    expect(() => assertNoMinorSexualContent({ bio: 'a village where children learn crafts' }, 'op')).not.toThrow();
    expect(() => validateCodaOperation({
      op: 'create', type: 'character', name: 'Adult Weaver', fields: { age: 34, notes: 'explicit scene with an adult partner' },
    }, 0, identity)).not.toThrow();
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

  it('performs a real update and reports the changed fields', async () => {
    const { pool, queries } = fakePool();
    const results = await executeCodaOperations(pool, identity, {
      operations: [{ op: 'update', targetRecordId: recordId, fields: { lore: 'maps the ash seas' } }],
    });
    expect(results[0]).toMatchObject({ status: 'applied', operation: 'update', recordId });
    expect(results[0].changedFields).toContain('document');
    expect(queries.some((query) => query.sql.startsWith('UPDATE library_assets'))).toBe(true);
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

  it('keeps a refused batch away from the database entirely', async () => {
    const { pool, queries, insertCount } = fakePool();
    await expect(executeCodaOperations(pool, identity, {
      operations: [{ op: 'create', type: 'character', name: 'Bad', fields: { contentRating: 'adult' } }],
    })).rejects.toThrow(CodaRuntimeError);
    expect(insertCount()).toBe(0);
    expect(queries.some((query) => query.sql.includes('INSERT INTO library_assets'))).toBe(false);
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
