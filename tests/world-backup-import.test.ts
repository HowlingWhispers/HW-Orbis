import { describe, expect, it } from 'vitest';
import { prepareWorldBackup } from '../server/world-backup-import.js';

const source = JSON.stringify({
  format: 'hw-world-backup',
  version: 1,
  exportedAt: '2026-09-09T02:22:47.533Z',
  world: {
    id: 'world-source-id',
    identity: { name: 'Private Test World', description: 'A test world.', genre: 'Fantasy', tone: 'Serious' },
    rules: {}, lore: {}, timeWeather: {},
    species: [{ id: 'species-one', name: 'Wolf', description: 'Wolf species.' }],
    locations: [{ id: 'place-one', name: 'Home', kind: 'building', description: 'A home.' }],
    factions: [], societies: [], families: [], memories: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
  },
  runtimeSession: null,
});

describe('world backup import preparation', () => {
  it('preserves stable source identities and applies private world settings', () => {
    const prepared = prepareWorldBackup(source, 'private');
    expect(prepared.assets).toHaveLength(3);
    const world = prepared.assets[0];
    expect(world.sourceAssetId).toBe('hw-world-backup-v1:world:world-source-id');
    expect(world.document.worldSettings).toEqual({
      visibility: 'private',
      showInLibrary: false,
      allowForking: false,
    });
    expect(prepared.assets.map((asset) => asset.sourceAssetId)).toContain('hw-world-backup-v1:place:place-one');
    expect(prepared.assets.map((asset) => asset.sourceAssetId)).toContain('hw-world-backup-v1:species:species-one');
  });
});
