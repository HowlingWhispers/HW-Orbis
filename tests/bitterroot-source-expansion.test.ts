import { describe, expect, it } from 'vitest';
import { buildBitterrootSeedAssets, type BitterrootSourceWorld } from '../server/bitterroot-import';
import source from '../server/data/bitterroot.json';

const assets = buildBitterrootSeedAssets(source as unknown as BitterrootSourceWorld);

const place = (sourceId: string) => assets.find((asset) => asset.sourceAssetId === `place:${sourceId}`);

describe('Bitterroot source expansion', () => {
  it('enriches Whispering Woods without creating a duplicate place', () => {
    const woods = place('whispering-woods');
    expect(woods).toBeDefined();
    expect(assets.filter((asset) => asset.sourceAssetId === 'place:whispering-woods')).toHaveLength(1);
    expect(woods?.document.supernaturalNature).toContain('living supernatural entity');
    expect(woods?.document.travellerRisk).toContain('selective');
    expect(woods?.document.soulCanon).toContain('souls remain trapped');
  });

  it('preserves the source locations while replacing placeholder descriptions with established lore', () => {
    expect(place('shadow-creek')?.summary).toContain('meandering creek');
    expect(place('moonflower-meadow')?.summary).toContain('sunlit clearing');
    expect(place('hidden-haven-cave')?.summary).toContain('secluded cave');
    expect(place('bitterroot-bluffs')?.summary).toContain('Imposing');
    expect(place('bitterroot-peak')?.summary).toContain('commanding summit');
  });

  it('restores the orphanage history instead of presenting it as a generic care institution', () => {
    const orphanage = place('bitterroot-orphanage');
    expect(orphanage?.summary).toContain('grim, imposing orphanage');
    expect(orphanage?.document.historicalCharacter).toContain('harsh discipline');
  });

  it('adds the established Whispering Woods metaphysics to the world document', () => {
    const world = assets.find((asset) => asset.sourceAssetId === 'world:public-bitterroot');
    const lore = world?.document.lore as Record<string, unknown> | undefined;
    const supernatural = lore?.supernatural as Record<string, unknown> | undefined;
    const woods = supernatural?.whisperingWoods as Record<string, unknown> | undefined;
    expect(woods?.classification).toBe('Living supernatural forest entity');
    expect(woods?.translationEffect).toContain('agony');
  });
});
