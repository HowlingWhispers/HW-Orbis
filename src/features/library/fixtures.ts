import type { LibraryAsset } from '../../types/library';

const now = '2026-09-05T20:00:00Z';

export const fixtures: LibraryAsset[] = [
  {
    id: 'world_bitterroot', type: 'world', name: 'Bitterroot',
    summary: 'A living wilderness of drowned valleys, old loyalties and hard-won shelter.',
    createdAt: '2026-08-29T12:00:00Z', updatedAt: now, sourceType: 'curated',
    tags: ['Pre-industrial', 'Wilderness', 'Living world'], dependencyCount: 74, pinned: true, visualTone: 'forest',
  },
  {
    id: 'char_ragna_holte', type: 'character', name: 'Ragna Holte',
    summary: 'A steady guard whose careful strength carries the weight of difficult choices.',
    originWorldId: 'world_bitterroot', originWorldName: 'Bitterroot', createdAt: '2026-08-30T12:00:00Z', updatedAt: now,
    sourceType: 'curated', tags: ['Werewolf', 'Guard', 'Holte family'], dependencyCount: 12, pinned: true, visualTone: 'moon',
  },
  {
    id: 'place_whispering_woods', type: 'place', name: 'Whispering Woods',
    summary: 'Ancient pines, silver streams and paths remembered differently by every traveler.',
    originWorldId: 'world_bitterroot', originWorldName: 'Bitterroot', createdAt: '2026-08-30T13:00:00Z', updatedAt: '2026-09-05T18:14:00Z',
    sourceType: 'user-created', tags: ['Forest', 'Region', 'Moonflower Meadow'], dependencyCount: 9, pinned: true, visualTone: 'mist',
  },
  {
    id: 'memory_great_flood', type: 'memory', name: 'The Great Flood',
    summary: 'The night the water remade the Howling Hills and scattered lives downstream.',
    originWorldId: 'world_bitterroot', originWorldName: 'Bitterroot', createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-05T16:20:00Z',
    sourceType: 'curated', tags: ['World event', 'Flood', 'Shared memory'], dependencyCount: 18, visualTone: 'river',
  },
  {
    id: 'faction_river_watch', type: 'faction', name: 'River Watch',
    summary: 'Watchers of the crossings, keeping careful records of every changing current.',
    originWorldId: 'world_bitterroot', originWorldName: 'Bitterroot', createdAt: '2026-09-02T12:00:00Z', updatedAt: '2026-09-05T14:10:00Z',
    sourceType: 'user-created', tags: ['Guards', 'Riverlands'], dependencyCount: 7, visualTone: 'ember',
  },
  {
    id: 'species_bitterroot_wolf', type: 'species', name: 'Bitterroot Wolf',
    summary: 'A resilient people shaped by close families, seasonal travel and the mountain cold.',
    originWorldId: 'world_bitterroot', originWorldName: 'Bitterroot', createdAt: '2026-08-31T12:00:00Z', updatedAt: '2026-09-04T20:00:00Z',
    sourceType: 'curated', tags: ['Wolf', 'Anthropomorphic'], dependencyCount: 15, visualTone: 'violet',
  },
  {
    id: 'family_holte', type: 'family', name: 'The Holte Family',
    summary: 'A small family bound together by fierce care, duty and years of survival.',
    originWorldId: 'world_bitterroot', originWorldName: 'Bitterroot', createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-04T18:00:00Z',
    sourceType: 'curated', tags: ['Family', 'Ragna', 'Pip'], dependencyCount: 8, visualTone: 'ember',
  },
  {
    id: 'society_brackenjaw', type: 'society', name: 'Brackenjaw',
    summary: 'A close-knit woodland society shaped by steep trails and guarded traditions.',
    originWorldId: 'world_bitterroot', originWorldName: 'Bitterroot', createdAt: '2026-09-03T12:00:00Z', updatedAt: '2026-09-04T15:00:00Z',
    sourceType: 'user-created', tags: ['Woodland', 'Settlement'], dependencyCount: 11, visualTone: 'forest',
  },
  {
    id: 'char_pip_holte', type: 'character', name: 'Pip Holte',
    summary: 'Curious, earnest and sheltered, with a bright instinct for the small wonders around her.',
    originWorldId: 'world_bitterroot', originWorldName: 'Bitterroot', createdAt: '2026-09-02T12:00:00Z', updatedAt: '2026-09-04T13:00:00Z',
    sourceType: 'curated', tags: ['Wolf', 'Holte family'], dependencyCount: 10, visualTone: 'moon',
  },
  {
    id: 'place_hidden_haven', type: 'place', name: 'Hidden Haven Cave',
    summary: 'A dry refuge behind a veil of ferns, known only to a careful few.',
    originWorldId: 'world_bitterroot', originWorldName: 'Bitterroot', createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-03T12:00:00Z',
    sourceType: 'user-created', tags: ['Cave', 'Shelter'], dependencyCount: 4, visualTone: 'violet',
  },
];
