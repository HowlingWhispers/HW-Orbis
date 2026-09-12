import { describe, expect, it } from 'vitest';
import { applyBrackenjawCanon } from '../server/bitterroot-brackenjaw-canon';
import { buildBitterrootSeedAssets, type BitterrootSourceWorld } from '../server/bitterroot-import';
import { applyWhisperingWoodsCanon } from '../server/bitterroot-whispering-canon';
import source from '../server/data/bitterroot.json';

const world = applyBrackenjawCanon(applyWhisperingWoodsCanon(source as unknown as BitterrootSourceWorld));
const assets = buildBitterrootSeedAssets(world);

describe('Brackenjaw civilian canon', () => {
  it('adds the militia-oriented households without turning Brackenjaw into a standing military settlement', () => {
    const society = world.societies.find((entry) => entry.id === 'brackenjaw-enclave-society');
    const militia = world.factions.find((entry) => entry.id === 'brackenjaw-militia');

    expect(society?.description).toContain('civilian frontier community');
    expect(society?.description).toContain('militia-oriented');
    expect(society?.factionIds).toEqual(expect.arrayContaining(['boundary-wardens', 'brackenjaw-militia']));
    expect(society?.familyIds).toEqual(expect.arrayContaining([
      'holt-family', 'ashforge-family', 'thornhide-family', 'timberfall-family', 'mossvale-family',
      'stonepaw-family', 'meadowstride-family', 'hearthmane-family', 'trailscar-family',
    ]));
    expect(militia?.description).toContain('residents first');
  });

  it('registers a distinctive residence and workplace for every new profession household', () => {
    const requiredPlaceIds = [
      'ashforge-house', 'ashforge-smithy', 'thornhide-cottage', 'thornhide-saddlery',
      'timberfall-house', 'timberfall-yard', 'mossvale-house', 'mossvale-infirmary',
      'stonepaw-house', 'stonepaw-stores', 'meadowstride-house', 'meadowstride-stables',
      'hearthmane-house', 'hearthmane-hall', 'trailscar-house', 'trailscar-lodge',
    ];
    const placeIds = world.locations.map((location) => location.id);
    for (const id of requiredPlaceIds) expect(placeIds).toContain(id);
    for (const location of world.locations.filter((entry) => requiredPlaceIds.includes(entry.id))) {
      expect(location.parentLocationId).toBe('brackenjaw-enclave');
    }
  });

  it('preserves each resident family, home, profession and militia links in character assets', () => {
    const torren = assets.find((asset) => asset.sourceAssetId === 'character:torren-ashforge');
    const edda = assets.find((asset) => asset.sourceAssetId === 'character:edda-mossvale');
    const daren = assets.find((asset) => asset.sourceAssetId === 'character:daren-thornhide');

    expect(torren?.document.familySourceId).toBe('ashforge-family');
    expect(torren?.document.homeLocationSourceId).toBe('ashforge-house');
    expect(torren?.document.workplaceLocationSourceIds).toEqual(['ashforge-smithy']);
    expect(torren?.document.factionSourceIds).toContain('brackenjaw-militia');
    expect(edda?.document.role).toBe('Healer / herbalist / field medic');
    expect(daren?.document.factionSourceIds).toEqual([]);
    expect(daren?.document.canonNote).toContain('Sela Thornhide');
  });

  it('keeps the Whispering Woods losses as explicit local history rather than runtime invention', () => {
    expect(world.memories.map((memory) => memory.id)).toEqual(expect.arrayContaining([
      'sela-thornhide-disappearance',
      'stonepaw-parents-disappearance',
      'rovan-trailscar-woods-incident',
    ]));
    const rovanMemory = world.memories.find((memory) => memory.id === 'rovan-trailscar-woods-incident');
    expect(rovanMemory?.persistentEffects).toContain('The event must not be filled in by runtime improvisation as settled history.');
  });

  it('expands the synchronized Bitterroot collection to the complete authored cast', () => {
    expect(assets).toHaveLength(77);
    expect(assets.filter((asset) => asset.type === 'character')).toHaveLength(23);
    expect(assets.filter((asset) => asset.type === 'place')).toHaveLength(30);
    expect(assets.filter((asset) => asset.type === 'family')).toHaveLength(9);
  });
});
