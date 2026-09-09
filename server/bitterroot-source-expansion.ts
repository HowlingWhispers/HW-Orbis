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
      'Whispering Lake is a high natural reservoir at Bitterroot Peak, fed by mountain springs and seasonal rain and linked downstream to Shadow Creek.',
      'The Warden\'s Watchtower stands over Bitterroot Orphanage as a surviving symbol of its oppressive historical regime.',
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
      description: 'A meandering creek cutting through the heart of Whispering Woods, often hidden beneath the dense canopy. Its steady water has supported generations of life and provides one of the forest\'s most reliable natural landmarks. It receives water from the high country around Bitterroot Peak and Whispering Lake.',
    },
    'hidden-haven-cave': {
      description: 'A secluded cave deep within Whispering Woods, its entrance concealed by vines and surrounding growth. Cool, damp, and difficult to find, it has served as a natural shelter and refuge for those seeking protection from weather or danger.',
    },
    'bitterroot-bluffs': {
      description: 'Imposing, weathered cliff country rising near Whispering Woods. The bluffs are difficult to approach, exposed to the elements, and marked by the passage of generations, standing over routes and low ground like natural sentinels.',
    },
    'bitterroot-peak': {
      description: 'A commanding summit north of Whispering Woods, with severe elevation, difficult weather, and slopes carrying scars associated with old conflict and forgotten history. Whispering Lake lies in the high country at its summit.',
    },
    'bitterroot-orphanage': {
      description: 'A grim, imposing orphanage established near the base of the Bitterroot Bluffs. Its history includes high fences, guards, harsh discipline, neglect, and an oppressive regime that left deep scars on former residents. The Warden\'s Watchtower looms over the grounds as a lasting symbol of that period of control.',
      historicalCharacter: 'The institution has a documented history of coercive authority, harsh discipline, and neglect. Present-day details should be authored separately rather than erasing that history.',
    },
  };

  world.locations = world.locations.map((location) => {
    const patch = locationPatches[location.id];
    return patch ? { ...location, ...patch } : location;
  });

  const existingLocationIds = new Set(world.locations.map((location) => location.id));
  const additionalLocations = [
    {
      id: 'whispering-lake',
      name: 'Whispering Lake',
      kind: 'lake',
      parentLocationId: 'bitterroot-peak',
      description: 'A vast natural reservoir in the high country of Bitterroot Peak, fed by mountain springs and seasonal rains. Its waters feed streams descending toward Whispering Woods and Shadow Creek. Before the catastrophic flood, prolonged rain, rising water, tremors, and cracking rock preceded the failure of the natural walls holding the lake.',
      geographicRelations: {
        northOf: ['whispering-woods'],
        feeds: ['shadow-creek'],
      },
      historicalRole: 'The failure of the natural walls containing Whispering Lake released the flood that devastated parts of Whispering Woods and the Howling Hills.',
    },
    {
      id: 'wardens-watchtower',
      name: "Warden's Watchtower",
      kind: 'building',
      parentLocationId: 'bitterroot-orphanage',
      description: 'An imposing watchtower overlooking the grounds of Bitterroot Orphanage. During the orphanage\'s oppressive period it served as a visible reminder of surveillance, authority, and control.',
      historicalRole: 'A symbol of the unchecked authority and oppressive regime once associated with Bitterroot Orphanage.',
    },
  ];

  world.locations.push(...additionalLocations.filter((location) => !existingLocationIds.has(location.id)));

  world.updatedAt = EXPANSION_UPDATED_AT;
  return world;
}
