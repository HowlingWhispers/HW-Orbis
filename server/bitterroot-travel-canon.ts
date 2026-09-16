import type { BitterrootSourceWorld } from './bitterroot-import.js';

const HOLLOWMERE_ID = 'hollowmere';
const UPDATED_AT = '2026-09-16T10:20:00.000Z';

type RouteProfile = {
  distanceKm: number;
  terrain: string;
  routeClass: string;
};

const ROUTES_FROM_HOLLOWMERE: Record<string, RouteProfile> = {
  hollowmere: { distanceKm: 0, terrain: 'settlement roads', routeClass: 'capital' },
  'bitterroot-orphanage': { distanceKm: 24, terrain: 'settled road and rolling country', routeClass: 'road' },
  'whispering-woods': { distanceKm: 46, terrain: 'forest road becoming narrow woodland trail', routeClass: 'mixed-road-trail' },
  'shadow-creek': { distanceKm: 49, terrain: 'woodland trail and creek approaches', routeClass: 'trail' },
  'moonflower-meadow': { distanceKm: 52, terrain: 'woodland trail and meadow track', routeClass: 'trail' },
  'hidden-haven-cave': { distanceKm: 56, terrain: 'woodland trail with rough final approach', routeClass: 'rough-trail' },
  'bitterroot-bluffs': { distanceKm: 63, terrain: 'rolling road giving way to exposed bluff tracks', routeClass: 'mixed-road-trail' },
  'splitpine-reach': { distanceKm: 67, terrain: 'upland road and cold ridge trails', routeClass: 'upland-road' },
  'bitterroot-peak': { distanceKm: 78, terrain: 'mountain approach with steep exposed trails', routeClass: 'mountain-trail' },
  'brackenjaw-enclave': { distanceKm: 82, terrain: 'upland road and defended settlement trail', routeClass: 'upland-road' },
  'brackenjaw-ranger-station': { distanceKm: 83, terrain: 'upland road and local settlement track', routeClass: 'upland-road' },
  'brackenjaw-eastern-boundary': { distanceKm: 94, terrain: 'patrol trail beyond Brackenjaw', routeClass: 'patrol-trail' },
  'warning-stones': { distanceKm: 97, terrain: 'patrol trail and rough boundary ground', routeClass: 'patrol-trail' },
};

const hours = (distanceKm: number, speedKph: number) => Math.round((distanceKm / speedKph) * 10) / 10;
const days = (hoursValue: number) => Math.round((hoursValue / 8) * 10) / 10;

function travelRecord(profile: RouteProfile, inheritedFromId: string | null = null) {
  const onFootHours = hours(profile.distanceKm, 4);
  const mountedHours = hours(profile.distanceKm, 6);
  const cartHours = hours(profile.distanceKm, 3);
  return {
    referenceLocationId: HOLLOWMERE_ID,
    distanceFromHollowmereKm: profile.distanceKm,
    distanceType: 'estimated-route',
    terrain: profile.terrain,
    routeClass: profile.routeClass,
    baselineTravelHours: {
      onFoot: onFootHours,
      mounted: mountedHours,
      cart: cartHours,
    },
    baselineTravelDaysAtEightHours: {
      onFoot: days(onFootHours),
      mounted: days(mountedHours),
      cart: days(cartHours),
    },
    estimateSource: 'Bitterroot regional map, calibrated for playable pre-industrial travel rather than the printed scale marker',
    estimateConfidence: 'approximate',
    inheritedFromLocationId: inheritedFromId,
  };
}

export function applyBitterrootTravelCanon(source: BitterrootSourceWorld): BitterrootSourceWorld {
  const world = structuredClone(source);

  if (!world.locations.some((location) => location.id === HOLLOWMERE_ID)) {
    world.locations.push({
      id: HOLLOWMERE_ID,
      name: 'Hollowmere',
      kind: 'capital settlement',
      parentLocationId: 'howling-hills',
      description: 'The capital settlement marked near the center of the Bitterroot regional map. Hollowmere is the reference point used for regional distance and baseline travel estimates.',
    });
  }

  const byId = new Map(world.locations.map((location) => [location.id, location]));
  const resolveProfile = (locationId: string, seen = new Set<string>()): { profile: RouteProfile; inheritedFromId: string | null } | null => {
    const direct = ROUTES_FROM_HOLLOWMERE[locationId];
    if (direct) return { profile: direct, inheritedFromId: null };
    if (seen.has(locationId)) return null;
    seen.add(locationId);
    const location = byId.get(locationId);
    const parentId = typeof location?.parentLocationId === 'string' ? location.parentLocationId : null;
    if (!parentId) return null;
    const inherited = resolveProfile(parentId, seen);
    if (!inherited) return null;
    return { profile: inherited.profile, inheritedFromId: parentId };
  };

  world.locations = world.locations.map((location) => {
    const resolved = resolveProfile(location.id);
    if (!resolved) return location;
    return {
      ...location,
      travelFromHollowmere: travelRecord(resolved.profile, resolved.inheritedFromId),
    };
  });

  const importantFacts = Array.isArray(world.lore.importantFacts)
    ? world.lore.importantFacts.filter((value): value is string => typeof value === 'string')
    : [];
  world.lore = {
    ...world.lore,
    importantFacts: [...new Set([
      ...importantFacts,
      'Hollowmere is the regional capital and the reference point for approximate Bitterroot travel distances.',
      'Travel distances are route estimates calibrated for pre-industrial gameplay; terrain, weather, fatigue, load and interruptions can change actual travel time.',
    ])],
  };
  world.updatedAt = UPDATED_AT;
  return world;
}
