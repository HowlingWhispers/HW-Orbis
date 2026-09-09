import type { BitterrootSourceWorld } from './bitterroot-import.js';

const WHISPERING_CANON_UPDATED_AT = '2026-09-09T08:50:00.000Z';

const uniqueStrings = (values: unknown, additions: string[]) => {
  const existing = Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
  return [...new Set([...existing, ...additions])];
};

export function applyWhisperingWoodsCanon(source: BitterrootSourceWorld): BitterrootSourceWorld {
  const world = structuredClone(source);

  world.lore = {
    ...world.lore,
    supernatural: {
      ...(typeof world.lore.supernatural === 'object' && world.lore.supernatural !== null ? world.lore.supernatural : {}),
      whisperingWoods: {
        classification: 'Living supernatural forest entity',
        ordinaryPassage: 'Healthy and emotionally grounded travellers may pass through without ever realizing anything supernatural is present.',
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
        physicalDeath: 'Those fully taken may die physically in peace, experiencing comfort rather than terror or pain.',
        soulFate: 'That peace is a lure rather than salvation. The victim\'s soul is trapped and incorporated into the forest instead of passing onward.',
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
      'Its supernatural attention is selective; healthy and emotionally grounded travellers may pass through without encountering it.',
      'It is especially dangerous to people who feel deeply lost, hopeless, abandoned, emotionally broken, or convinced they have nowhere left to go.',
      'The woods can lure vulnerable travellers with familiar voices, false hope, comfort, warmth, beauty, memories, apparent loved ones, and relief.',
      'Those fully taken may die peacefully while their souls remain trapped and incorporated into the forest.',
      'The suffering of trapped souls is translated into comforting or beautiful impressions for the living. The forest makes agony sound like mercy.',
    ]),
  };

  world.locations = world.locations.map((location) => location.id === 'whispering-woods'
    ? {
        ...location,
        description: 'An expansive ancient forest threaded by Shadow Creek. To many healthy travellers it can appear to be difficult but ordinary wilderness. To people who are deeply lost, hopeless, abandoned, emotionally broken, or convinced they have nowhere left to go, the forest may reveal itself as a living supernatural predator that offers comfort, familiar voices, beauty, memories, false hope, and apparent safety in order to draw them deeper.',
        supernaturalNature: 'The forest itself is a living supernatural entity with awareness, hunger, memory, and intent.',
        travellerRisk: 'Its supernatural attention is selective rather than universal and is especially dangerous to emotionally vulnerable travellers.',
        lureBehavior: 'It can imitate familiar voices and offer warmth, love, beauty, pleasure, relief, comforting memories, false hope, and apparent reunions.',
        soulCanon: 'Victims may die physically in peace, but their souls remain trapped within the forest. The suffering of those imprisoned spirits is transformed into beautiful and comforting impressions for living ears, helping lure future victims.',
      }
    : location);

  world.factions = world.factions.map((faction) => faction.id === 'boundary-wardens'
    ? {
        ...faction,
        threatDoctrine: 'Boundary Wardens treat credible travel toward Whispering Woods by a distressed, emotionally vulnerable, inexperienced, or young traveller as a serious safety threat. A Warden should warn, question, escort, redirect, delay, or otherwise intervene according to local authority and immediate circumstances rather than casually sending such a traveller onward. This does not itself establish general arrest powers.',
      }
    : faction);

  world.updatedAt = WHISPERING_CANON_UPDATED_AT;
  return world;
}
