import { describe, expect, it } from 'vitest';
import type { BitterrootSourceWorld } from '../server/bitterroot-import.js';
import { applyWhisperingWoodsCanon } from '../server/bitterroot-whispering-canon.js';

function sourceWorld(): BitterrootSourceWorld {
  return {
    id: 'public-bitterroot',
    identity: { name: 'Bitterroot', description: 'test', genre: 'Dark fantasy', tone: 'test' },
    rules: {},
    lore: { importantFacts: [] },
    species: [],
    locations: [
      { id: 'whispering-woods', name: 'Whispering Woods', description: 'old' },
      { id: 'moonflower-meadow', name: 'Moonflower Meadow', description: 'leave unchanged' },
    ],
    factions: [
      { id: 'boundary-wardens', name: 'Boundary Wardens', description: 'rangers' },
    ],
    societies: [],
    families: [],
    memories: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('Whispering Woods canon promotion', () => {
  it('promotes the approved supernatural danger without rewriting unrelated geography', () => {
    const updated = applyWhisperingWoodsCanon(sourceWorld());
    const woods = updated.locations.find((location) => location.id === 'whispering-woods');
    const meadow = updated.locations.find((location) => location.id === 'moonflower-meadow');
    const wardens = updated.factions.find((faction) => faction.id === 'boundary-wardens');
    const supernatural = updated.lore.supernatural as Record<string, unknown>;
    const woodsLore = supernatural.whisperingWoods as Record<string, unknown>;

    expect(woods?.supernaturalNature).toContain('living supernatural entity');
    expect(woods?.travellerRisk).toContain('emotionally vulnerable');
    expect(woodsLore.selectiveAwareness).toContain('hopeless');
    expect(woodsLore.translationEffect).toContain('agony');
    expect(wardens?.threatDoctrine).toContain('serious safety threat');
    expect(wardens?.threatDoctrine).toContain('does not itself establish general arrest powers');
    expect(meadow?.description).toBe('leave unchanged');
  });
});
