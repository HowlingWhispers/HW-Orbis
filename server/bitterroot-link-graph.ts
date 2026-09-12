import type { BitterrootSourceWorld } from './bitterroot-import.js';

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const unique = (values: string[]) => [...new Set(values)];

export function applyBitterrootLinkGraph(source: BitterrootSourceWorld): BitterrootSourceWorld {
  const world = structuredClone(source);

  const childLocations = new Map<string, string[]>();
  const residentCharacters = new Map<string, string[]>();
  const workerCharacters = new Map<string, string[]>();
  const locationFamilies = new Map<string, string[]>();
  const factionCharacters = new Map<string, string[]>();
  const familyCharacters = new Map<string, string[]>();

  for (const location of world.locations) {
    const parent = typeof location.parentLocationId === 'string' ? location.parentLocationId : null;
    if (parent) childLocations.set(parent, [...(childLocations.get(parent) ?? []), location.id]);
  }

  for (const family of world.families) {
    const familyHome = typeof family.homeLocationId === 'string' ? family.homeLocationId : null;
    if (familyHome) locationFamilies.set(familyHome, [...(locationFamilies.get(familyHome) ?? []), family.id]);
    for (const workplace of strings(family.workplaceLocationIds)) {
      locationFamilies.set(workplace, [...(locationFamilies.get(workplace) ?? []), family.id]);
    }

    for (const person of family.people ?? []) {
      if (!person.characterId) continue;
      familyCharacters.set(family.id, [...(familyCharacters.get(family.id) ?? []), person.characterId]);
      const home = typeof person.homeLocationSourceId === 'string' ? person.homeLocationSourceId : null;
      if (home) residentCharacters.set(home, [...(residentCharacters.get(home) ?? []), person.characterId]);
      for (const workplace of strings(person.workplaceLocationSourceIds)) {
        workerCharacters.set(workplace, [...(workerCharacters.get(workplace) ?? []), person.characterId]);
      }
      for (const faction of strings(person.factionSourceIds)) {
        factionCharacters.set(faction, [...(factionCharacters.get(faction) ?? []), person.characterId]);
      }
    }
  }

  world.locations = world.locations.map((location) => ({
    ...location,
    childLocationIds: unique([...(strings(location.childLocationIds)), ...(childLocations.get(location.id) ?? [])]),
    residentCharacterIds: unique([...(strings(location.residentCharacterIds)), ...(residentCharacters.get(location.id) ?? [])]),
    workerCharacterIds: unique([...(strings(location.workerCharacterIds)), ...(workerCharacters.get(location.id) ?? [])]),
    familyIds: unique([...(strings(location.familyIds)), ...(locationFamilies.get(location.id) ?? [])]),
  }));

  world.factions = world.factions.map((faction) => ({
    ...faction,
    characterIds: unique([...(strings(faction.characterIds)), ...(factionCharacters.get(faction.id) ?? [])]),
  }));

  world.families = world.families.map((family) => ({
    ...family,
    characterIds: unique([...(strings(family.characterIds)), ...(familyCharacters.get(family.id) ?? [])]),
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
  }

  for (const faction of world.factions) {
    const owner = `faction:${faction.id}`;
    checkMany(owner, 'characterIds', faction.characterIds, characterIds);
    checkMany(owner, 'locationIds', faction.locationIds, locationIds);
  }

  for (const society of world.societies) {
    const owner = `society:${society.id}`;
    check(owner, 'parentSocietyId', society.parentSocietyId, societyIds);
    checkMany(owner, 'territoryLocationIds', society.territoryLocationIds, locationIds);
    checkMany(owner, 'settlementLocationIds', society.settlementLocationIds, locationIds);
    checkMany(owner, 'speciesIds', society.speciesIds, speciesIds);
    checkMany(owner, 'familyIds', society.familyIds, familyIds);
    checkMany(owner, 'factionIds', society.factionIds, factionIds);
    checkMany(owner, 'allySocietyIds', society.allySocietyIds, societyIds);
    checkMany(owner, 'rivalSocietyIds', society.rivalSocietyIds, societyIds);
  }

  for (const family of world.families) {
    const owner = `family:${family.id}`;
    check(owner, 'homeLocationId', family.homeLocationId, locationIds);
    checkMany(owner, 'workplaceLocationIds', family.workplaceLocationIds, locationIds);
    checkMany(owner, 'characterIds', family.characterIds, characterIds);
    for (const person of family.people ?? []) {
      const personOwner = `character:${person.characterId ?? person.id}`;
      check(personOwner, 'speciesSourceId', person.speciesSourceId, speciesIds);
      check(personOwner, 'homeLocationSourceId', person.homeLocationSourceId, locationIds);
      checkMany(personOwner, 'workplaceLocationSourceIds', person.workplaceLocationSourceIds, locationIds);
      checkMany(personOwner, 'factionSourceIds', person.factionSourceIds, factionIds);
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
