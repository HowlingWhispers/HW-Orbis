import { describe, expect, it } from 'vitest';
import type { BitterrootSourceWorld } from '../server/bitterroot-import.js';
import { applySlaveMarketCanon } from '../server/bitterroot-slave-market-canon.js';

function sourceWorld(): BitterrootSourceWorld {
  return {
    id: 'public-bitterroot',
    identity: { name: 'Bitterroot', description: 'test', genre: 'Dark fantasy', tone: 'test' },
    rules: {},
    lore: { importantFacts: [] },
    species: [],
    locations: [
      { id: 'howling-hills', name: 'Howling Hills', description: 'region' },
    ],
    factions: [],
    societies: [],
    families: [],
    memories: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('Bitterroot slave market canon', () => {
  it('adds a procedural market with a minimum sale age of five and persistent generated people', () => {
    const updated = applySlaveMarketCanon(sourceWorld());
    const market = updated.locations.find((location) => location.id === 'slave-market');
    const institutions = updated.lore.institutions as Record<string, unknown>;
    const marketLore = institutions.slaveMarket as Record<string, unknown>;

    expect(market).toBeDefined();
    expect(market?.parentLocationId).toBe('howling-hills');
    expect(market?.fixedCharacters).toBe(false);
    expect(market?.populationModel).toBe('procedural');
    expect(market?.minimumSaleAge).toBe(5);
    expect(market?.persistenceRule).toContain('persistent world state');
    expect(marketLore.minimumSaleAge).toBe(5);
    expect(marketLore.minimumSaleAgeRule).toContain('No person younger than five');
    expect(marketLore.populationWeighting).toContain('Working-age adults');
    expect(marketLore.paperwork).toContain('forged');
    expect(marketLore.familySeparation).toContain('sold separately');
  });

  it('is idempotent and does not duplicate the market when canon is applied twice', () => {
    const once = applySlaveMarketCanon(sourceWorld());
    const twice = applySlaveMarketCanon(once);

    expect(twice.locations.filter((location) => location.id === 'slave-market')).toHaveLength(1);
  });
});
