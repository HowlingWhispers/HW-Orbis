import { describe, expect, it } from 'vitest';
import {
  createWorldAuthoringTemplate,
  parseWorldAuthoringJson,
  stringifyWorldAuthoringTemplate,
} from '../src/features/library/world-json';

describe('world JSON authoring', () => {
  it('round-trips the blank authoring template into a private world draft', () => {
    const result = parseWorldAuthoringJson(stringifyWorldAuthoringTemplate());
    expect(result.format).toBe('orbis-authoring');
    expect(result.asset.type).toBe('world');
    expect(result.asset.name).toBe('Untitled World');
    expect(result.asset.document?.worldSettings).toEqual({
      visibility: 'private',
      showInLibrary: false,
      allowForking: false,
    });
  });

  it('accepts an Orbis world record shape', () => {
    const result = parseWorldAuthoringJson(JSON.stringify({
      type: 'world',
      name: 'Glass Coast',
      summary: 'Salt, glass and storms.',
      contentRating: 'sfw',
      tags: ['coast'],
      visualTone: 'river',
      document: {
        identity: { name: 'Glass Coast', description: 'Salt, glass and storms.' },
        locations: [{ id: 'harbor', name: 'Old Harbor' }],
      },
    }));
    expect(result.format).toBe('orbis-world-record');
    expect(result.asset.name).toBe('Glass Coast');
    expect(result.asset.visualTone).toBe('river');
    expect(result.asset.document?.locations).toHaveLength(1);
  });

  it('accepts legacy hw-world-backup version 1', () => {
    const result = parseWorldAuthoringJson(JSON.stringify({
      format: 'hw-world-backup',
      version: 1,
      exportedAt: '2026-09-26T18:00:00.000Z',
      world: {
        id: 'legacy-world',
        identity: { name: 'Old World', description: 'Recovered lore.', genre: 'Fantasy', tone: 'Dark' },
        rules: {},
        lore: {},
        species: [],
        locations: [],
        factions: [],
        families: [],
        memories: [],
        societies: [],
        timeWeather: {},
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-26T00:00:00.000Z',
      },
    }));
    expect(result.format).toBe('hw-world-backup-v1');
    expect(result.asset.name).toBe('Old World');
    expect(result.asset.tags).toContain('Fantasy');
    expect(result.asset.tags).toContain('Imported world');
  });

  it('forces authoring imports back to private settings', () => {
    const template = createWorldAuthoringTemplate();
    template.name = 'Private Review';
    template.data.worldSettings = {
      visibility: 'public',
      showInLibrary: true,
      allowForking: true,
    };
    const result = parseWorldAuthoringJson(JSON.stringify(template));
    expect(result.asset.document?.worldSettings).toEqual({
      visibility: 'private',
      showInLibrary: false,
      allowForking: false,
    });
  });

  it('rejects transfer archives so their identity graph is not flattened into one world', () => {
    expect(() => parseWorldAuthoringJson(JSON.stringify({
      format: 'orbis-transfer',
      version: 1,
      records: [],
    }))).toThrow(/Account → Upload archive/);
  });

  it('reports malformed JSON clearly', () => {
    expect(() => parseWorldAuthoringJson('{"format":')).toThrow(/Invalid JSON/);
  });
});
