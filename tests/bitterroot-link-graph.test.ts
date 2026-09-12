import { describe, expect, it } from 'vitest';
import { applyBrackenjawCanon } from '../server/bitterroot-brackenjaw-canon';
import { applyBitterrootCoreLinks } from '../server/bitterroot-core-links';
import { buildBitterrootSeedAssets, type BitterrootSourceWorld } from '../server/bitterroot-import';
import { applyBitterrootLinkGraph, auditBitterrootLinks } from '../server/bitterroot-link-graph';
import { applyWhisperingWoodsCanon } from '../server/bitterroot-whispering-canon';
import source from '../server/data/bitterroot.json';

const world = applyBitterrootLinkGraph(
  applyBitterrootCoreLinks(
    applyBrackenjawCanon(
      applyWhisperingWoodsCanon(source as unknown as BitterrootSourceWorld),
    ),
  ),
);
const assets = buildBitterrootSeedAssets(world);

describe('Bitterroot relationship graph', () => {
  it('contains no dangling canonical references', () => {
    expect(auditBitterrootLinks(world)).toEqual([]);
  });

  it('links Brackenjaw back to its registered child places and residents', () => {
    const brackenjaw = world.locations.find((location) => location.id === 'brackenjaw-enclave');
    expect(brackenjaw).toBeTruthy();
    expect(brackenjaw?.childLocationIds).toEqual(expect.arrayContaining([
      'brackenjaw-ranger-station',
      'ashforge-house',
      'ashforge-smithy',
      'thornhide-cottage',
      'thornhide-saddlery',
      'timberfall-house',
      'timberfall-yard',
      'mossvale-house',
      'mossvale-infirmary',
      'stonepaw-house',
      'stonepaw-stores',
      'meadowstride-house',
      'meadowstride-stables',
      'hearthmane-house',
      'hearthmane-hall',
      'trailscar-house',
      'trailscar-lodge',
    ]));
    expect(brackenjaw?.residentCharacterIds).toEqual(expect.arrayContaining(['ragna-holt', 'pip-holt']));
  });

  it('gives reciprocal links to homes, workplaces, families and factions', () => {
    const smithy = world.locations.find((location) => location.id === 'ashforge-smithy');
    const house = world.locations.find((location) => location.id === 'ashforge-house');
    const militia = world.factions.find((faction) => faction.id === 'brackenjaw-militia');
    const wardens = world.factions.find((faction) => faction.id === 'boundary-wardens');
    const ashforge = world.families.find((family) => family.id === 'ashforge-family');
    const holt = world.families.find((family) => family.id === 'holt-family');

    expect(smithy?.workerCharacterIds).toContain('torren-ashforge');
    expect(smithy?.familyIds).toContain('ashforge-family');
    expect(house?.residentCharacterIds).toEqual(expect.arrayContaining(['torren-ashforge', 'jori-ashforge']));
    expect(militia?.characterIds).toContain('torren-ashforge');
    expect(militia?.locationIds).toContain('brackenjaw-enclave');
    expect(wardens?.characterIds).toContain('ragna-holt');
    expect(wardens?.locationIds).toEqual(expect.arrayContaining(['brackenjaw-ranger-station', 'brackenjaw-eastern-boundary', 'warning-stones']));
    expect(ashforge?.characterIds).toEqual(expect.arrayContaining(['torren-ashforge', 'jori-ashforge']));
    expect(holt?.homeLocationId).toBe('brackenjaw-enclave');
  });

  it('mirrors society and memory relationships back to referenced records', () => {
    const orphanage = world.locations.find((location) => location.id === 'bitterroot-orphanage');
    const howlingHills = world.locations.find((location) => location.id === 'howling-hills');
    const regionalSociety = world.societies.find((society) => society.id === 'howling-hills-peoples');

    expect(orphanage?.societyIds).toContain('bitterroot-orphanage-household');
    expect(howlingHills?.memoryIds).toContain('howling-hills-flood');
    expect(regionalSociety?.childSocietyIds).toEqual(expect.arrayContaining([
      'whispering-woods-clans',
      'bitterroot-orphanage-household',
      'bitterroot-bluffs-bands',
      'bitterroot-peak-clans',
      'brackenjaw-enclave-society',
    ]));
  });

  it('reports actual reference counts on place cards', () => {
    const brackenjaw = assets.find((asset) => asset.sourceAssetId === 'place:brackenjaw-enclave');
    const smithy = assets.find((asset) => asset.sourceAssetId === 'place:ashforge-smithy');
    expect(brackenjaw?.dependencyCount).toBeGreaterThan(0);
    expect(smithy?.dependencyCount).toBeGreaterThan(0);
  });
});
