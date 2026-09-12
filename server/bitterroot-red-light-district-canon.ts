import type { BitterrootSourceWorld } from './bitterroot-import.js';

const RED_LIGHT_DISTRICT_CANON_UPDATED_AT = '2026-09-12T11:25:00.000Z';

const uniqueStrings = (values: unknown, additions: string[]) => {
  const existing = Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
  return [...new Set([...existing, ...additions])];
};

export function applyRedLightDistrictCanon(source: BitterrootSourceWorld): BitterrootSourceWorld {
  const world = structuredClone(source);

  world.lore = {
    ...world.lore,
    institutions: {
      ...(typeof world.lore.institutions === 'object' && world.lore.institutions !== null ? world.lore.institutions : {}),
      redLightDistrict: {
        classification: 'Adult entertainment and sex-work district',
        exactPlacement: 'The district is canonically located somewhere in the populated Howling Hills, but its exact settlement placement remains open until that settlement is added to mapped canon.',
        adultOnlySexualCommerce: true,
        minimumSexWorkerAge: 18,
        clientMinimumAge: 18,
        fixedRoster: false,
        populationModel: 'Procedural. Workers, patrons, proprietors, guards, performers, merchants, healers, cooks, cleaners, and other district inhabitants may be generated as needed and become persistent after meaningful interaction.',
        consentRule: 'Sexual services may only be assigned to consenting adults age eighteen or older. Coercion, trafficking, or forced sexual labor may exist only as criminal or conflict lore, never as a valid generated job assignment.',
        slaveMarketSeparationRule: 'No person under eighteen from the slave market may ever be routed into sexual work. Slave-market generation and red-light-district sexual-service generation are separate systems.',
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
          'Adult sex worker',
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
      'Bitterroot has a canonical red-light district in the populated Howling Hills; its exact settlement placement remains open until mapped settlement canon is expanded.',
      'The red-light district has no fixed character roster and may generate workers, patrons, proprietors, guards, performers, merchants, and other inhabitants procedurally.',
      'Sexual services in the district are restricted to consenting adults age eighteen or older, and clients must also be adults.',
      'People under eighteen from the slave market may never be routed into sexual work.',
      'Procedurally generated district inhabitants become persistent after meaningful interaction and cannot then be rerolled out of existence.',
    ]),
  };

  const district = {
    id: 'red-light-district',
    name: 'Red Light District',
    kind: 'district',
    parentLocationId: 'howling-hills',
    description: 'An adult entertainment district serving travellers and locals through taverns, bathhouses, music and dance halls, gambling rooms, inns, private houses, food stalls, and other late-night businesses. Its population is procedural rather than a fixed roster. Sexual services are adult-only and restricted to consenting adults age eighteen or older.',
    contentRating: 'adult',
    canonStatus: 'canon',
    exactSettlementPlacement: null,
    placementNote: 'Keep this district under Howling Hills until its host settlement is established in Orbis canon, then re-parent it without changing its canonical identity.',
    fixedCharacters: false,
    populationModel: 'procedural',
    minimumSexWorkerAge: 18,
    clientMinimumAge: 18,
    sexualServicesRequireAdultConsent: true,
    generatedPopulationRoles: [
      'adult sex worker',
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
