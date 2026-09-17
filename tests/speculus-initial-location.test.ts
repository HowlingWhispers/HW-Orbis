import { describe, expect, it } from 'vitest';
import { resolveInitialLocationId, simulationNavigationData } from '../server/speculus';

const row = (value: Record<string, unknown>) => value;

describe('Speculus initial location packaging', () => {
  it('uses Hollowmere for a non-place Bitterroot launch', () => {
    const primary = row({ id: 'character-1', type: 'character', name: 'Ragna Holt', document: {} });
    const related = [
      row({ id: 'world-1', type: 'world', name: 'Bitterroot', document: {} }),
      row({ id: 'place-hollowmere', type: 'place', name: 'Hollowmere', source_asset_id: 'place:hollowmere', document: { id: 'hollowmere' } }),
    ];
    expect(resolveInitialLocationId(primary, related)).toBe('place-hollowmere');
  });

  it('restores canonical Bitterroot navigation for rows imported before travel metadata existed', () => {
    const navigation = simulationNavigationData(row({
      type: 'place',
      source_asset_id: 'place:brackenjaw-ranger-station',
      document: { id: 'brackenjaw-ranger-station', kind: 'building', parentLocationId: 'brackenjaw-enclave' },
    }), true);

    expect(navigation).toMatchObject({
      sourceId: 'brackenjaw-ranger-station',
      parentLocationId: 'brackenjaw-enclave',
      travelFromHollowmere: { distanceFromHollowmereKm: 83, routeClass: 'upland-road' },
    });
  });

  it('starts a directly launched place at itself', () => {
    const primary = row({ id: 'place-brackenjaw', type: 'place', name: 'Brackenjaw Enclave', document: { sourceId: 'brackenjaw-enclave' } });
    expect(resolveInitialLocationId(primary, [])).toBe('place-brackenjaw');
  });

  it('does not invent a starter for unrelated worlds', () => {
    const primary = row({ id: 'character-1', type: 'character', name: 'Someone', document: {} });
    const related = [row({ id: 'world-other', type: 'world', name: 'Other World', document: {} })];
    expect(resolveInitialLocationId(primary, related)).toBeUndefined();
  });
});
