import { describe, expect, it } from 'vitest';
import { isStartingPlaceInSimulationScope } from '../server/speculus';

describe('Speculus starting Place scope', () => {
  it('allows a Place from the same world as the simulated record', () => {
    const character = { id: 'character', type: 'character', origin_world_id: 'world-a' };
    const place = { id: 'place-a', type: 'place', origin_world_id: 'world-a' };
    expect(isStartingPlaceInSimulationScope(character, place)).toBe(true);
  });

  it('allows a world to start at one of its Places', () => {
    const world = { id: 'world-a', type: 'world' };
    const place = { id: 'place-a', type: 'place', origin_world_id: 'world-a' };
    expect(isStartingPlaceInSimulationScope(world, place)).toBe(true);
  });

  it('allows a directly simulated standalone Place to anchor to itself', () => {
    const place = { id: 'place-a', type: 'place' };
    expect(isStartingPlaceInSimulationScope(place, place)).toBe(true);
  });

  it('rejects a Place from another world', () => {
    const character = { id: 'character', type: 'character', origin_world_id: 'world-a' };
    const place = { id: 'place-b', type: 'place', origin_world_id: 'world-b' };
    expect(isStartingPlaceInSimulationScope(character, place)).toBe(false);
  });
});
