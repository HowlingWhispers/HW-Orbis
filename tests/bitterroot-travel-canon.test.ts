import { describe, expect, it } from 'vitest';
import source from '../server/data/bitterroot.json';
import { applyBrackenjawCanon } from '../server/bitterroot-brackenjaw-canon';
import { applyBitterrootTravelCanon } from '../server/bitterroot-travel-canon';
import type { BitterrootSourceWorld } from '../server/bitterroot-import';

const world = applyBitterrootTravelCanon(
  applyBrackenjawCanon(source as unknown as BitterrootSourceWorld),
);

const place = (id: string) => world.locations.find((location) => location.id === id)!;

describe('Bitterroot travel canon', () => {
  it('adds Hollowmere as the regional travel reference capital', () => {
    const hollowmere = place('hollowmere');
    expect(hollowmere.name).toBe('Hollowmere');
    expect(hollowmere.parentLocationId).toBe('howling-hills');
    expect(hollowmere.travelFromHollowmere).toMatchObject({
      referenceLocationId: 'hollowmere',
      distanceFromHollowmereKm: 0,
      estimateConfidence: 'approximate',
    });
  });

  it('stores baseline route distance and travel time from Hollowmere', () => {
    expect(place('brackenjaw-enclave').travelFromHollowmere).toMatchObject({
      referenceLocationId: 'hollowmere',
      distanceFromHollowmereKm: 82,
      routeClass: 'upland-road',
      baselineTravelHours: { onFoot: 20.5, mounted: 13.7, cart: 27.3 },
    });
    expect(place('whispering-woods').travelFromHollowmere).toMatchObject({
      distanceFromHollowmereKm: 46,
      routeClass: 'mixed-road-trail',
    });
  });

  it('lets local places inherit the parent settlement travel reference', () => {
    const smithy = place('ashforge-smithy').travelFromHollowmere as Record<string, unknown>;
    expect(smithy.distanceFromHollowmereKm).toBe(82);
    expect(smithy.inheritedFromLocationId).toBe('brackenjaw-enclave');
  });

  it('marks map-derived travel data as approximate rather than exact geography', () => {
    const travel = place('bitterroot-peak').travelFromHollowmere as Record<string, unknown>;
    expect(travel.estimateSource).toContain('calibrated for playable pre-industrial travel');
    expect(travel.estimateConfidence).toBe('approximate');
  });
});
