import type { BitterrootSourceWorld } from './bitterroot-import.js';

const SLAVE_MARKET_CANON_UPDATED_AT = '2026-09-12T11:05:00.000Z';

const uniqueStrings = (values: unknown, additions: string[]) => {
  const existing = Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
  return [...new Set([...existing, ...additions])];
};

export function applySlaveMarketCanon(source: BitterrootSourceWorld): BitterrootSourceWorld {
  const world = structuredClone(source);

  world.lore = {
    ...world.lore,
    institutions: {
      ...(typeof world.lore.institutions === 'object' && world.lore.institutions !== null ? world.lore.institutions : {}),
      slaveMarket: {
        classification: 'Permanent slave-trading institution',
        legalCharacter: 'Slavery is accepted in some Bitterroot jurisdictions and rejected or restricted in others. The market operates where local authority permits or tolerates it.',
        minimumSaleAge: 5,
        minimumSaleAgeRule: 'People offered for sale through the market may be five years old or older. No person younger than five may be generated as market stock.',
        fixedRoster: false,
        populationModel: 'Procedural. The market does not require a permanent roster of pre-authored captives.',
        populationWeighting: 'Working-age adults should make up most generated market stock. Adolescents, older people, and children from age five upward may appear less frequently.',
        commonOrigins: [
          'Debt bondage',
          'Criminal sentence',
          'War captivity',
          'Raids and bandit capture',
          'Kidnapping',
          'Abandonment',
          'Sale by desperate relatives or guardians',
          'Transfer from a previous owner',
          'Fraudulent or forged legal claims',
        ],
        commonUses: [
          'Household service',
          'Agricultural labor',
          'Craft or trade apprenticeship',
          'Stable and animal work',
          'Messenger work',
          'Mining and heavy labor',
          'Military support work',
          'Repayment of debt or sentence',
        ],
        paperwork: 'The market trades the claimed legal ownership or bondage status attached to a person. Papers may be legitimate, disputed, forged, bribed into existence, or based on a false story.',
        familySeparation: 'Families are not guaranteed to remain together. Parents, children, and siblings may be sold separately unless a seller, buyer, or local rule keeps them together.',
        persistenceRule: 'A procedurally generated person becomes persistent world state after meaningful observation or interaction, including being named, questioned, purchased, freed, injured, escaping, dying, forming a relationship, or otherwise affecting the simulation. Persistent people may not be rerolled out of existence.',
        generatedFields: [
          'Age',
          'Species and body form',
          'Place of origin',
          'Route into slavery',
          'Claimed legal status',
          'Occupation and skills',
          'Health and injuries',
          'Temperament',
          'Literacy',
          'Languages',
          'Family connections',
          'Escape risk',
          'Seller or intermediary',
          'Asking price',
          'Paperwork legitimacy',
        ],
        causeChainRule: 'Generated people should have a plausible causal history connecting their origin, capture or debt, transport, paperwork, and arrival at the market instead of existing as isolated random entries.',
      },
    },
    importantFacts: uniqueStrings(world.lore.importantFacts, [
      'A permanent slave market exists in Bitterroot where local authority permits or tolerates the trade.',
      'The slave market may sell people from age five upward; nobody younger than five is generated as market stock.',
      'The slave market has no fixed captive roster. Market stock may be generated procedurally as needed.',
      'Procedurally generated market people become persistent world entities after meaningful observation or interaction and cannot then be rerolled out of existence.',
      'Slave-market paperwork may be legitimate, disputed, forged, bribed into existence, or based on a false origin story.',
      'Families are not guaranteed to remain together when sold through the slave market.',
    ]),
  };

  const market = {
    id: 'slave-market',
    name: 'The Slave Market',
    kind: 'market',
    parentLocationId: 'howling-hills',
    description: 'A permanent slave-trading market in the Howling Hills, operating under local authority where the trade is permitted or tolerated. It has no fixed captive roster: people offered for sale are generated procedurally as needed, with working-age adults forming the majority while people as young as five may also appear.',
    canonStatus: 'canon',
    fixedCharacters: false,
    populationModel: 'procedural',
    minimumSaleAge: 5,
    generationRules: {
      minimumAge: 5,
      adultMajority: true,
      requireCauseChain: true,
      generatedFields: [
        'age',
        'species',
        'origin',
        'routeIntoSlavery',
        'legalStatus',
        'skills',
        'health',
        'injuries',
        'temperament',
        'literacy',
        'languages',
        'familyConnections',
        'escapeRisk',
        'seller',
        'askingPrice',
        'paperworkLegitimacy',
      ],
    },
    persistenceRule: 'Once a generated person is meaningfully observed or interacted with, preserve that person as persistent world state and do not replace them through rerolling.',
  };

  const existingMarketIndex = world.locations.findIndex((location) => location.id === market.id);
  if (existingMarketIndex >= 0) world.locations[existingMarketIndex] = market;
  else world.locations.push(market);

  world.updatedAt = SLAVE_MARKET_CANON_UPDATED_AT;
  return world;
}
