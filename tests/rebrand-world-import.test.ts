import { describe, expect, it } from 'vitest';
import { buildRebrandWorldImportPlan, parseRebrandWorldBackup, stableImportUuid } from '../server/rebrand-world-import';

describe('Rebrand world import planning', () => {
  it('builds stable world and child asset IDs without mutating source IDs', () => {
    const backup = parseRebrandWorldBackup({
      format: 'hw-world-backup',
      version: 1,
      exportedAt: '2026-09-09T00:00:00.000Z',
      runtimeSession: null,
      world: {
        id: 'world-source-1',
        identity: { name: 'Private World', description: 'A rescue test.' },
        species: [{ id: 'species-a', name: 'Wolf' }],
        locations: [{ id: 'location-a', name: 'Home', kind: 'building' }],
        factions: [],
        families: [{ id: 'family-a', name: 'Household', people: [], relationships: [] }],
        memories: [],
        societies: [],
      },
    });

    const plan = buildRebrandWorldImportPlan(backup);
    expect(plan.worldId).toBe(stableImportUuid('world:world-source-1'));
    expect(plan.assets).toHaveLength(4);
    expect(plan.counts).toEqual({ world: 1, place: 1, species: 1, faction: 0, society: 0, family: 1, memory: 0 });
    expect(plan.assets.find((asset) => asset.type === 'place')?.sourceExternalId).toBe('location-a');
    expect(plan.assets.every((asset) => asset.originWorldId === null || asset.originWorldId === plan.worldId)).toBe(true);
  });

  it('refuses unsupported backup formats', () => {
    expect(() => parseRebrandWorldBackup({ format: 'other', version: 1, world: {} })).toThrow();
  });
});
