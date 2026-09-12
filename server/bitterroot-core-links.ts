import type { BitterrootSourceWorld } from './bitterroot-import.js';

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const unique = (values: string[]) => [...new Set(values)];

export function applyBitterrootCoreLinks(source: BitterrootSourceWorld): BitterrootSourceWorld {
  const world = structuredClone(source);

  world.families = world.families.map((family) => {
    if (family.id !== 'holt-family') return family;
    return {
      ...family,
      homeLocationId: 'brackenjaw-enclave',
      people: (family.people ?? []).map((person) => {
        if (person.characterId === 'ragna-holt') {
          return {
            ...person,
            homeLocationSourceId: 'brackenjaw-enclave',
            workplaceLocationSourceIds: unique([...strings(person.workplaceLocationSourceIds), 'brackenjaw-ranger-station']),
            factionSourceIds: unique([...strings(person.factionSourceIds), 'boundary-wardens']),
          };
        }
        if (person.characterId === 'pip-holt') {
          return {
            ...person,
            homeLocationSourceId: 'brackenjaw-enclave',
          };
        }
        return person;
      }),
    };
  });

  world.factions = world.factions.map((faction) => {
    if (faction.id === 'boundary-wardens') {
      return {
        ...faction,
        locationIds: unique([
          ...strings(faction.locationIds),
          'brackenjaw-ranger-station',
          'brackenjaw-eastern-boundary',
          'warning-stones',
        ]),
      };
    }
    if (faction.id === 'brackenjaw-militia') {
      return {
        ...faction,
        locationIds: unique([...strings(faction.locationIds), 'brackenjaw-enclave']),
      };
    }
    return faction;
  });

  return world;
}
