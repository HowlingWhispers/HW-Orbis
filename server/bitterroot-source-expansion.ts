import type { BitterrootSourceWorld } from './bitterroot-import.js';

const EXPANSION_UPDATED_AT = '2026-09-09T06:24:00.000Z';

const uniqueStrings = (values: unknown, additions: string[]) => {
  const existing = Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
  return [...new Set([...existing, ...additions])];
};

export function applyBitterrootSourceExpansion(source: BitterrootSourceWorld): BitterrootSourceWorld {
  const world = structuredClone(source);

  world.lore = {
    ...world.lore,
    supernatural: {
      ...(typeof world.lore.supernatural === 'object' && world.lore.supernatural !== null ? world.lore.supernatural : {}),
      whisperingWoods: {
        classification: 'Living supernatural forest entity',
        ordinaryPassage: 'Healthy, emotionally grounded travellers may cross the woods without ever realizing that anything supernatural is present.',
        selectiveAwareness: 'The woods selectively notices people who feel deeply lost, hopeless, abandoned, emotionally broken, or convinced they have nowhere left to go.',
        lure: [
          'Familiar voices',
          'Warmth and safety',
          'Love and beauty',
          'Pleasure and relief',
          'False hope',
          'Comforting memories',
          'The apparent presence of loved ones',
        ],
        physicalDeath: 'Those fully taken by the woods may die peacefully, experiencing comfort rather than physical terror or pain.',
        soulFate: 'The peace is a lure rather than salvation. The victim\'s soul is trapped and incorporated into the forest instead of passing onward.',
        translationEffect: 'The agony and screams of trapped spirits are transformed for living listeners into beautiful, peaceful, loving, comforting sounds and sensations. The forest makes agony sound like mercy.',
        trappedRealm: {
          state: 'Captivity between destinations',
          paths: [
            { position: 'upper', destination: 'Heaven', reachable: false },
            { position: 'middle', destination: 'The living world', reachable: false },
            { position: 'lower', destination: 'Hell', reachable: false },
          ],
        },
      },
    },
    importantFacts: uniqueStrings(world.lore.importantFacts, [
      'Whispering Woods is a living supernatural entity, not merely an ordinary haunted forest.',
      'The supernatural influence of Whispering Woods is selective; healthy and emotionally grounded travellers may pass through without encountering it.',
      'Souls taken by Whispering Woods are trapped after a peaceful physical death, and their suffering is translated into beauty and comfort for the living.',
    ]),
  };

  const locationPatches: Record<string, Record<string, unknown>> = {
    'howling-hills': {
      description: 'A broad, rugged major region known for echoing wild calls, difficult high country, isolated communities, and the scars of the catastrophic flood that drowned valleys and permanently changed routes, waterways, and settlement patterns.',
    },
    'whispering-woods': {
      description: 'An expansive ancient forest where sunlight struggles through a dense canopy and the wind carries whispers associated with generations of joy, grief, disappearance, and death. Shadow Creek threads through its interior, while Moonflower Meadow and Hidden Haven Cave lie within it. To most healthy travellers it may seem like difficult but ordinary wilderness. To certain lost or hopeless people, the forest reveals a far more dangerous nature.',
      supernaturalNature: 'The forest is itself a living supernatural entity with awareness, hunger, memory, and intent.',
      travellerRisk: 'Its supernatural attention is selective rather than universal. It is most dangerous to those who feel profoundly lost, abandoned, hopeless, or without anywhere left to go.',
      lureBehavior: 'It can offer familiar voices, warmth, love, beauty, pleasure, relief, false hope, comforting memories, and apparent reunions in order to make surrender feel safe.',
      soulCanon: 'Victims may die physically in peace, but their souls remain trapped within the forest. The suffering of those imprisoned spirits is transformed into beautiful and comforting impressions for living ears, helping the forest lure future victims.',
    },
    'moonflower-meadow': {
      description: 'A sunlit clearing within Whispering Woods where moonflowers and other wildflowers bloom in striking color. The meadow offers an unusual pocket of warmth, openness, and serenity amid the forest canopy, making it feel like a natural refuge from the surrounding shadows.',
    },
    'shadow-creek': {
      description: 'A meandering creek cutting through the heart of Whispering Woods, often hidden beneath the dense canopy. Its steady water has supported generations of life and provides one of the forest\'s most reliable natural landmarks, though following water does not make the deeper woods harmless.',
    },
    'hidden-haven-cave': {
      description: 'A secluded cave deep within Whispering Woods, its entrance concealed by vines and surrounding growth. Cool, damp, and difficult to find, it has served as a natural shelter and refuge for those seeking protection from weather or danger.',
    },
    'bitterroot-bluffs': {
      description: 'Imposing, weathered cliff country rising near Whispering Woods. The bluffs are difficult to approach, exposed to the elements, and marked by the passage of generations, standing over routes and low ground like natural sentinels.',
    },
    'bitterroot-peak': {
      description: 'A commanding summit above the surrounding Bitterroot country, with severe elevation, difficult weather, and slopes carrying scars associated with old conflict and forgotten history. From its high ground, travellers can look across vast portions of the central region.',
    },
    'bitterroot-orphanage': {
      description: 'A grim, imposing orphanage established near the Bitterroot Bluffs. Its history includes high fences, guards, harsh discipline, neglect, and an oppressive regime that left deep scars on former residents. The Warden\'s Watchtower became a lasting symbol of that period of control.',
      historicalCharacter: 'The institution has a documented history of coercive authority, harsh discipline, and neglect. Present-day details should be authored separately rather than erasing that history.',
    },
  };

  world.locations = world.locations.map((location) => {
    const patch = locationPatches[location.id];
    return patch ? { ...location, ...patch } : location;
  });

  world.updatedAt = EXPANSION_UPDATED_AT;
  return world;
}
