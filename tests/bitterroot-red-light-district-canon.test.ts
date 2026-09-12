import { describe, expect, it } from 'vitest';
import { buildBitterrootSeedAssets, type BitterrootSourceWorld } from '../server/bitterroot-import.js';
import { applyRedLightDistrictCanon } from '../server/bitterroot-red-light-district-canon.js';

function sourceWorld(): BitterrootSourceWorld {
  return {
    id: 'public-bitterroot',
    identity: { name: 'Bitterroot', description: 'test', genre: 'Dark fantasy', tone: 'test' },
    rules: {},
    lore: { importantFacts: [] },
    species: [],
    locations: [
      { id: 'howling-hills', name: 'Howling Hills', kind: 'major region', description: 'region' },
    ],
    factions: [],
    societies: [],
    families: [],
    memories: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('Bitterroot red-light district canon', () => {
  it('adds an adult-rated procedural district with adult-only sexual commerce', () => {
    const updated = applyRedLightDistrictCanon(sourceWorld());
    const district = updated.locations.find((location) => location.id === 'red-light-district');

    expect(district?.parentLocationId).toBe('howling-hills');
    expect(district?.contentRating).toBe('adult');
    expect(district?.fixedCharacters).toBe(false);
    expect(district?.minimumSexWorkerAge).toBe(18);
    expect(district?.clientMinimumAge).toBe(18);
    expect(district?.sexualServicesRequireAdultConsent).toBe(true);
    expect(district?.exactSettlementPlacement).toBeNull();
  });

  it('keeps slave-market minors out of sexual work and preserves generated people after interaction', () => {
    const updated = applyRedLightDistrictCanon(sourceWorld());
    const institutions = updated.lore.institutions as Record<string, unknown>;
    const districtLore = institutions.redLightDistrict as Record<string, unknown>;

    expect(districtLore.slaveMarketSeparationRule).toContain('under eighteen');
    expect(districtLore.consentRule).toContain('consenting adults');
    expect(districtLore.persistenceRule).toContain('persistent world state');
  });

  it('imports the district as an adult-gated place asset while leaving the world card sfw', () => {
    const updated = applyRedLightDistrictCanon(sourceWorld());
    const assets = buildBitterrootSeedAssets(updated);
    const world = assets.find((asset) => asset.sourceAssetId === 'world:public-bitterroot');
    const district = assets.find((asset) => asset.sourceAssetId === 'place:red-light-district');

    expect(world?.contentRating).toBe('sfw');
    expect(district?.contentRating).toBe('adult');
  });
});
