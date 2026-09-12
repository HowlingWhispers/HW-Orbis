import { describe, expect, it } from 'vitest';
import { applyBrackenjawCanon } from '../server/bitterroot-brackenjaw-canon';
import { buildBitterrootSeedAssets, type BitterrootSourceWorld } from '../server/bitterroot-import';
import { applyBitterrootLinkGraph, auditBitterrootLinks } from '../server/bitterroot-link-graph';
import { applyWhisperingWoodsCanon } from '../server/bitterroot-whispering-canon';
import source from '../server/data/bitterroot.json';

const world = applyBitterrootLinkGraph(
  applyBrackenjawCanon(
    applyWhisperingWoodsCanon(source as unknown as BitterrootSourceWorld),
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
    const ashforge = world.families.find((family) => family.id === 'ashforge-family');

    expect(smithy?.workerCharacterIds).toContain('torren-ashforge');
    expect(smithy?.familyIds).toContain('ashforge-family');
    expect(house?.residentCharacterIds).toEqual(expect.arrayContaining(['torren-ashforge', 'jori-ashforge']));
    expect(militia?.characterIds).toContain('torren-ashforge');
    expect(ashforge?.characterIds).toEqual(expect.arrayContaining(['torren-ashforge', 'jori-ashforge']));
  });

  it('reports actual reference counts on place cards', () => {
    const brackenjaw = assets.find((asset) => asset.sourceAssetId === 'place:brackenjaw-enclave');
    const smithy = assets.find((asset) => asset.sourceAssetId === 'place:ashforge-smithy');
    expect(brackenjaw?.dependencyCount).toBeGreaterThan(0);
    expect(smithy?.dependencyCount).toBeGreaterThan(0);
  });
});
