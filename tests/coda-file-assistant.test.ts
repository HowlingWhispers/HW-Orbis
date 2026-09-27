import { describe, expect, it } from 'vitest';
import { codaPlaceCreateFromPatch } from '../src/components/CodaFileAssistant';
import type { LibraryAsset } from '../src/types/library';

const world: LibraryAsset = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'world',
  name: 'Test World',
  summary: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  sourceType: 'user-created',
  contentRating: 'sfw',
  tags: [],
  dependencyCount: 0,
  visualTone: 'forest',
  document: { locations: [] },
};

describe('Coda file assistant Place target', () => {
  it('turns the approved one-place draft into a canonical child create', () => {
    const create = codaPlaceCreateFromPatch(world, {
      locations: [{
        id: 'model-id', libraryAssetId: 'model-library-id', worldEntryId: 'model-entry-id',
        name: 'Moon Harbor', kind: 'settlement', description: 'Lanterns on black water.', parentLocationId: 'coast',
      }],
    });

    expect(create).toEqual({
      type: 'place',
      name: 'Moon Harbor',
      summary: 'Lanterns on black water.',
      contentRating: 'sfw',
      tags: [],
      visualTone: 'mist',
      document: { kind: 'settlement', description: 'Lanterns on black water.', parentLocationId: 'coast' },
    });
    expect(create).not.toHaveProperty('originWorldId');
    expect(create.document).not.toHaveProperty('locations');
    expect(create.document).not.toHaveProperty('libraryAssetId');
  });

  it('refuses a draft without one named Place', () => {
    expect(() => codaPlaceCreateFromPatch(world, { locations: [] })).toThrow(/one valid place/);
    expect(() => codaPlaceCreateFromPatch(world, { locations: [{}] })).toThrow(/needs a name/);
  });
});
