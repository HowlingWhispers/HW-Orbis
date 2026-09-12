import type { BitterrootSourceWorld } from './bitterroot-import.js';

const RED_LIGHT_DISTRICT_CANON_UPDATED_AT = '2026-09-12T11:40:00.000Z';

const uniqueStrings = (values: unknown, additions: string[]) => {
  const existing = Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
  return [...new Set([...existing, ...additions])];
};

export function applyRedLightDistrictCanon(source: BitterrootSourceWorld): BitterrootSourceWorld {
  const world = structuredClone(source);

  const hollowmere = {
    id: 'hollowmere',
    name: 'Hollowmere',
    kind: 'settlement',
    parentLocationId: 'howling-hills',
    description: 'A major settlement in the Howling Hills on the western side of Whispering Woods. Hollowmere serves as an important local center for trade, lodging, entertainment, services, and travelers moving through the region.',
    canonStatus: 'canon',
  };

  const hollowmereIndex = world.locations.findIndex((location) => location.id === hollowmere.id);
  if (hollowmereIndex >= 0) world.locations[hollowmereIndex] = { ...world.locations[hollowmereIndex], ...hollowmere };
  else world.locations.push(hollowmere);

  world.lore = {
    ...world.lore,
    institutions: {
      ...(typeof world.lore.institutions === 'object' && world.lore.institutions !== null ? world.lore.institutions : {}),
      redLightDistrict: {
        classification: 'Entertainment and sex-work district',
        exactPlacement: 'The district is located in Hollowmere.',
        fixedRoster: false,
        populationModel: 'Procedural. Workers, patrons, proprietors, guards, performers, merchants, healers, cooks, cleaners, and other district inhabitants may be generated as needed and become persistent after meaningful interaction.',
        eligibilityRule: 'Eligibility for sexual roles, services, and related participation is governed by the configured world and user rule set rather than hardcoded locally in this district.',
        commonVenues: [
          'Brothels and private houses',
          'Taverns and drinking rooms',
          'Bathhouses',
          'Music and dance halls',
          'Gambling rooms',
          'Cheap inns and rented rooms',
          'Food stalls and late-night kitchens',
          'Healers and apothecaries',
          'Laundry and clothing services',
          'Security and door guards',
        ],
        commonJobs: [
          'Sex worker',
          'Host or hostess',
          'Performer',
          'Musician',
          'Bartender',
          'Cook',
          'Cleaner',
          'Laundry worker',
          'Guard or bouncer',
          'Healer',
          'Innkeeper',
          'Bookkeeper',
          'Runner or messenger',
          'Merchant',
        ],
        generatedFields: [
          'Age',
          'Species and body form',
          'Occupation',
          'Employer or venue',
          'Home district or place of origin',
          'Skills',
          'Reputation',
          'Health',
          'Temperament',
          'Languages',
          'Income and debts',
          'Relationships and regular contacts',
          'Reason for working or visiting the district',
        ],
        persistenceRule: 'A procedurally generated person becomes persistent world state after meaningful observation or interaction and may not be rerolled out of existence.',
      },
    },
    importantFacts: uniqueStrings(world.lore.importantFacts, [
      'Hollowmere is an established settlement in the Howling Hills on the western side of Whispering Woods.',
      'Bitterroot\'s canonical red-light district is located in Hollowmere.',
      'The red-light district has no fixed character roster and may generate workers, patrons, proprietors, guards, performers, merchants, and other inhabitants procedurally.',
      'Eligibility for sexual roles and services is controlled by the configured world and user rule set rather than a district-specific hardcoded age rule.',
      'Procedurally generated district inhabitants become persistent after meaningful interaction and cannot then be rerolled out of existence.',
    ]),
  };

  const district = {
    id: 'red-light-district',
    name: 'Red Light District',
    kind: 'district',
    parentLocationId: 'hollowmere',
    description: 'Hollowmere\'s entertainment district, serving travelers and locals through taverns, bathhouses, music and dance halls, gambling rooms, inns, private houses, food stalls, and other late-night businesses. Its population is procedural rather than a fixed roster.',
    contentRating: 'adult' as const,
    canonStatus: 'canon',
    fixedCharacters: false,
    populationModel: 'procedural',
    eligibilityRuleSource: 'world-and-user-configured-rules',
    generatedPopulationRoles: [
      'sex worker',
      'host',
      'performer',
      'musician',
      'bartender',
      'cook',
      'cleaner',
      'laundry worker',
      'guard',
      'healer',
      'innkeeper',
      'bookkeeper',
      'messenger',
      'merchant',
      'patron',
    ],
    persistenceRule: 'Once a generated person is meaningfully observed or interacted with, preserve that person as persistent world state and do not replace them through rerolling.',
  };

  const existingDistrictIndex = world.locations.findIndex((location) => location.id === district.id);
  if (existingDistrictIndex >= 0) world.locations[existingDistrictIndex] = district;
  else world.locations.push(district);

  world.updatedAt = RED_LIGHT_DISTRICT_CANON_UPDATED_AT;
  return world;
}
