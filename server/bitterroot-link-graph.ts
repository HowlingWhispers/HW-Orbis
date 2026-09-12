import type { BitterrootSourceWorld } from './bitterroot-import.js';

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const unique = (values: string[]) => [...new Set(values)];
const add = (map: Map<string, string[]>, key: string, value: string) => map.set(key, [...(map.get(key) ?? []), value]);

export function applyBitterrootLinkGraph(source: BitterrootSourceWorld): BitterrootSourceWorld {
  const world = structuredClone(source);

  const childLocations = new Map<string, string[]>();
  const residentCharacters = new Map<string, string[]>();
  const workerCharacters = new Map<string, string[]>();
  const locationFamilies = new Map<string, string[]>();
  const factionCharacters = new Map<string, string[]>();
  const familyCharacters = new Map<string, string[]>();
  const locationSocieties = new Map<string, string[]>();
  const childSocieties = new Map<string, string[]>();
  const speciesSocieties = new Map<string, string[]>();
  const locationMemories = new Map<string, string[]>();
  const factionMemories = new Map<string, string[]>();
  const familyMemories = new Map<string, string[]>();
  const characterMemories = new Map<string, string[]>();

  for (const location of world.locations) {
    const parent = typeof location.parentLocationId === 'string' ? location.parentLocationId : null;
    if (parent) add(childLocations, parent, location.id);
  }

  for (const society of world.societies) {
    const parent = typeof society.parentSocietyId === 'string' ? society.parentSocietyId : null;
    if (parent) add(childSocieties, parent, society.id);
    for (const location of unique([...strings(society.territoryLocationIds), ...strings(society.settlementLocationIds)])) add(locationSocieties, location, society.id);
    for (const species of strings(society.speciesIds)) add(speciesSocieties, species, society.id);
  }

  for (const family of world.families) {
    const familyHome = typeof family.homeLocationId === 'string' ? family.homeLocationId : null;
    if (familyHome) add(locationFamilies, familyHome, family.id);
    for (const workplace of strings(family.workplaceLocationIds)) add(locationFamilies, workplace, family.id);

    for (const person of family.people ?? []) {
      if (!person.characterId) continue;
      add(familyCharacters, family.id, person.characterId);
      const home = typeof person.homeLocationSourceId === 'string' ? person.homeLocationSourceId : null;
      if (home) add(residentCharacters, home, person.characterId);
      for (const workplace of strings(person.workplaceLocationSourceIds)) add(workerCharacters, workplace, person.characterId);
      for (const faction of strings(person.factionSourceIds)) add(factionCharacters, faction, person.characterId);
    }
  }

  for (const memory of world.memories) {
    for (const location of strings(memory.locationIds)) add(locationMemories, location, memory.id);
    for (const faction of strings(memory.factionIds)) add(factionMemories, faction, memory.id);
    for (const family of strings(memory.familyIds)) add(familyMemories, family, memory.id);
    for (const character of strings(memory.affectedCharacterIds)) add(characterMemories, character, memory.id);
  }

  world.locations = world.locations.map((location) => ({
    ...location,
    childLocationIds: unique([...strings(location.childLocationIds), ...(childLocations.get(location.id) ?? [])]),
    residentCharacterIds: unique([...strings(location.residentCharacterIds), ...(residentCharacters.get(location.id) ?? [])]),
    workerCharacterIds: unique([...strings(location.workerCharacterIds), ...(workerCharacters.get(location.id) ?? [])]),
    familyIds: unique([...strings(location.familyIds), ...(locationFamilies.get(location.id) ?? [])]),
    societyIds: unique([...strings(location.societyIds), ...(locationSocieties.get(location.id) ?? [])]),
    memoryIds: unique([...strings(location.memoryIds), ...(locationMemories.get(location.id) ?? [])]),
  }));

  world.factions = world.factions.map((faction) => ({
    ...faction,
    characterIds: unique([...strings(faction.characterIds), ...(factionCharacters.get(faction.id) ?? [])]),
    memoryIds: unique([...strings(faction.memoryIds), ...(factionMemories.get(faction.id) ?? [])]),
  }));

  world.societies = world.societies.map((society) => ({
    ...society,
    childSocietyIds: unique([...strings(society.childSocietyIds), ...(childSocieties.get(society.id) ?? [])]),
  }));

  world.species = world.species.map((species) => ({
    ...species,
    societyIds: unique([...strings(species.societyIds), ...(speciesSocieties.get(species.id) ?? [])]),
  }));

  world.families = world.families.map((family) => ({
    ...family,
    characterIds: unique([...strings(family.characterIds), ...(familyCharacters.get(family.id) ?? [])]),
    memoryIds: unique([...strings(family.memoryIds), ...(familyMemories.get(family.id) ?? [])]),
    people: (family.people ?? []).map((person) => person.characterId
      ? { ...person, memoryIds: unique([...strings(person.memoryIds), ...(characterMemories.get(person.characterId) ?? [])]) }
      : person),
  }));

  return world;
}

export type BitterrootLinkIssue = {
  owner: string;
  field: string;
  target: string;
};

export function auditBitterrootLinks(world: BitterrootSourceWorld): BitterrootLinkIssue[] {
  const locationIds = new Set(world.locations.map((item) => item.id));
  const factionIds = new Set(world.factions.map((item) => item.id));
  const societyIds = new Set(world.societies.map((item) => item.id));
  const familyIds = new Set(world.families.map((item) => item.id));
  const speciesIds = new Set(world.species.map((item) => item.id));
  const memoryIds = new Set(world.memories.map((item) => item.id));
  const characterIds = new Set(world.families.flatMap((family) => (family.people ?? []).map((person) => person.characterId).filter((id): id is string => typeof id === 'string')));
  const issues: BitterrootLinkIssue[] = [];

  const check = (owner: string, field: string, target: unknown, known: Set<string>) => {
    if (typeof target === 'string' && target && !known.has(target)) issues.push({ owner, field, target });
  };
  const checkMany = (owner: string, field: string, targets: unknown, known: Set<string>) => {
    for (const target of strings(targets)) check(owner, field, target, known);
  };

  for (const location of world.locations) {
    const owner = `place:${location.id}`;
    check(owner, 'parentLocationId', location.parentLocationId, locationIds);
    checkMany(owner, 'childLocationIds', location.childLocationIds, locationIds);
    checkMany(owner, 'residentCharacterIds', location.residentCharacterIds, characterIds);
    checkMany(owner, 'workerCharacterIds', location.workerCharacterIds, characterIds);
    checkMany(owner, 'familyIds', location.familyIds, familyIds);
    checkMany(owner, 'societyIds', location.societyIds, societyIds);
    checkMany(owner, 'memoryIds', location.memoryIds, memoryIds);
  }

  for (const faction of world.factions) {
    const owner = `faction:${faction.id}`;
    checkMany(owner, 'characterIds', faction.characterIds, characterIds);
    checkMany(owner, 'locationIds', faction.locationIds, locationIds);
    checkMany(owner, 'memoryIds', faction.memoryIds, memoryIds);
  }

  for (const society of world.societies) {
    const owner = `society:${society.id}`;
    check(owner, 'parentSocietyId', society.parentSocietyId, societyIds);
    checkMany(owner, 'childSocietyIds', society.childSocietyIds, societyIds);
    checkMany(owner, 'territoryLocationIds', society.territoryLocationIds, locationIds);
    checkMany(owner, 'settlementLocationIds', society.settlementLocationIds, locationIds);
    checkMany(owner, 'speciesIds', society.speciesIds, speciesIds);
    checkMany(owner, 'familyIds', society.familyIds, familyIds);
    checkMany(owner, 'factionIds', society.factionIds, factionIds);
    checkMany(owner, 'allySocietyIds', society.allySocietyIds, societyIds);
    checkMany(owner, 'rivalSocietyIds', society.rivalSocietyIds, societyIds);
  }

  for (const species of world.species) checkMany(`species:${species.id}`, 'societyIds', species.societyIds, societyIds);

  for (const family of world.families) {
    const owner = `family:${family.id}`;
    check(owner, 'homeLocationId', family.homeLocationId, locationIds);
    checkMany(owner, 'workplaceLocationIds', family.workplaceLocationIds, locationIds);
    checkMany(owner, 'characterIds', family.characterIds, characterIds);
    checkMany(owner, 'memoryIds', family.memoryIds, memoryIds);
    for (const person of family.people ?? []) {
      const personOwner = `character:${person.characterId ?? person.id}`;
      check(personOwner, 'speciesSourceId', person.speciesSourceId, speciesIds);
      check(personOwner, 'homeLocationSourceId', person.homeLocationSourceId, locationIds);
      checkMany(personOwner, 'workplaceLocationSourceIds', person.workplaceLocationSourceIds, locationIds);
      checkMany(personOwner, 'factionSourceIds', person.factionSourceIds, factionIds);
      checkMany(personOwner, 'memoryIds', person.memoryIds, memoryIds);
    }
  }

  for (const memory of world.memories) {
    const owner = `memory:${memory.id}`;
    checkMany(owner, 'locationIds', memory.locationIds, locationIds);
    checkMany(owner, 'factionIds', memory.factionIds, factionIds);
    checkMany(owner, 'familyIds', memory.familyIds, familyIds);
    checkMany(owner, 'affectedCharacterIds', memory.affectedCharacterIds, characterIds);
  }

  return issues;
}
