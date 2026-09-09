import { describe, expect, it } from 'vitest';
import { FixtureLibraryApi } from '../src/api/fixture-client';

describe('FixtureLibraryApi', () => {
  const api = new FixtureLibraryApi();

  it('returns category counts for the Library home', async () => {
    const overview = await api.getOverview();
    expect(overview.counts.character).toBeGreaterThan(0);
    expect(overview.counts.place).toBeGreaterThan(0);
    expect(overview.recent).toHaveLength(4);
  });

  it('filters assets by category and search text', async () => {
    const response = await api.listAssets({ type: 'character', search: 'ragna' });
    expect(response.total).toBe(1);
    expect(response.items[0].id).toBe('char_ragna_holte');
  });

  it('returns independent sorted results', async () => {
    const response = await api.listAssets({ sort: 'name' });
    expect(response.items[0].name.localeCompare(response.items[1].name)).toBeLessThanOrEqual(0);
  });
});
