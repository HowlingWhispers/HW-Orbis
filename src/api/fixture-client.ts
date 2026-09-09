import type { LibraryApi } from './contracts';
import type { AssetListResponse, AssetQuery, LibraryOverview } from '../types/library';
import type { LibraryAssetUpdate } from '../types/library';
import { assetTypes } from '../types/library';
import { fixtures } from '../features/library/fixtures';

const pause = () => new Promise((resolve) => window.setTimeout(resolve, 80));

export class FixtureLibraryApi implements LibraryApi {
  async getOverview(): Promise<LibraryOverview> {
    await pause();
    return {
      recent: [...fixtures].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4),
      pinned: fixtures.filter((asset) => asset.pinned),
      counts: Object.fromEntries(assetTypes.map((type) => [type, fixtures.filter((asset) => asset.type === type).length])) as LibraryOverview['counts'],
    };
  }

  async listAssets(query: AssetQuery = {}): Promise<AssetListResponse> {
    await pause();
    const needle = query.search?.toLocaleLowerCase().trim();
    const items = fixtures
      .filter((asset) => !query.type || asset.type === query.type)
      .filter((asset) => !query.sourceType || asset.sourceType === query.sourceType)
      .filter((asset) => !needle || [asset.name, asset.summary, asset.originWorldName, ...asset.tags].some((value) => value?.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => query.sort === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt));
    return { items, total: items.length };
  }

  async getAsset(id: string) {
    await pause();
    const asset = fixtures.find((item) => item.id === id);
    if (!asset) throw new Error(`Asset not found: ${id}`);
    return asset;
  }

  async updateAsset(id: string, update: LibraryAssetUpdate) {
    await pause();
    const asset = fixtures.find((item) => item.id === id);
    if (!asset) throw new Error(`Asset not found: ${id}`);
    Object.assign(asset, update, { updatedAt: new Date().toISOString() });
    return asset;
  }

  async simulateAsset(_id: string): Promise<{ launchUrl: string; expiresAt: number }> {
    throw new Error('Speculus launches require the live Orbis API.');
  }
}
