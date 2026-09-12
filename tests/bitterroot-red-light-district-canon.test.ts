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
  it('adds Hollowmere and places the procedural district inside it', () => {
    const updated = applyRedLightDistrictCanon(sourceWorld());
    const hollowmere = updated.locations.find((location) => location.id === 'hollowmere');
    const district = updated.locations.find((location) => location.id === 'red-light-district');

    expect(hollowmere?.parentLocationId).toBe('howling-hills');
    expect(hollowmere?.canonStatus).toBe('canon');
    expect(district?.parentLocationId).toBe('hollowmere');
    expect(district?.contentRating).toBe('adult');
    expect(district?.fixedCharacters).toBe(false);
    expect(district?.eligibilityRuleSource).toBe('world-and-user-configured-rules');
  });

  it('uses the configured world/user rules instead of district-local eligibility values', () => {
    const updated = applyRedLightDistrictCanon(sourceWorld());
    const institutions = updated.lore.institutions as Record<string, unknown>;
    const districtLore = institutions.redLightDistrict as Record<string, unknown>;

    expect(districtLore.exactPlacement).toContain('Hollowmere');
    expect(districtLore.eligibilityRule).toContain('world and user rule set');
    expect(districtLore.minimumSexWorkerAge).toBeUndefined();
    expect(districtLore.clientMinimumAge).toBeUndefined();
    expect(districtLore.persistenceRule).toContain('persistent world state');
  });

  it('imports Hollowmere and the district as separate place assets', () => {
    const updated = applyRedLightDistrictCanon(sourceWorld());
    const assets = buildBitterrootSeedAssets(updated);
    const world = assets.find((asset) => asset.sourceAssetId === 'world:public-bitterroot');
    const hollowmere = assets.find((asset) => asset.sourceAssetId === 'place:hollowmere');
    const district = assets.find((asset) => asset.sourceAssetId === 'place:red-light-district');

    expect(world?.contentRating).toBe('sfw');
    expect(hollowmere?.contentRating).toBe('sfw');
    expect(district?.contentRating).toBe('adult');
  });
});
