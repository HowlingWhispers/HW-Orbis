import { describe, expect, it } from 'vitest';
import {
  buildSimulationLaunchDirection,
  isStartingPlaceInSimulationScope,
  simulationPersonaAdultToneEligible,
  simulationPersonaAge,
} from '../server/speculus';

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

describe('Speculus launch-only steering', () => {
  it('extracts explicit Persona ages from numeric and string identity fields', () => {
    expect(simulationPersonaAge({ document: { identity: { age: 22 } } })).toBe(22);
    expect(simulationPersonaAge({ document: { identity: { age: '18 years old' } } })).toBe(18);
    expect(simulationPersonaAge({ document: { identity: { age: 'unknown' } } })).toBeUndefined();
  });

  it('requires both 18+ access and an explicitly adult Persona for adult tone', () => {
    const adult = { document: { identity: { age: '21' } } };
    const minor = { document: { identity: { age: '12' } } };
    expect(simulationPersonaAdultToneEligible(adult, true)).toBe(true);
    expect(simulationPersonaAdultToneEligible(adult, false)).toBe(false);
    expect(simulationPersonaAdultToneEligible(minor, true)).toBe(false);
  });

  it('renders tone, tags and freeform direction as launch-only non-canon steering', () => {
    const direction = buildSimulationLaunchDirection({
      tone: 'mature',
      focusTags: ['storm', 'slow-burn'],
      direction: 'Keep the journey tense and character-focused.',
    });
    expect(direction).toContain('LAUNCH-ONLY / NOT CANON');
    expect(direction).toContain('Content tone: Mature.');
    expect(direction).toContain('Focus tags: storm, slow-burn.');
    expect(direction).toContain('Keep the journey tense and character-focused.');
  });

  it('does not add steering when the default tone has no tags or direction', () => {
    expect(buildSimulationLaunchDirection({ tone: 'world-default', focusTags: [], direction: '' })).toBe('');
  });
});
