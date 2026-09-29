import type { LibraryApi, OwnershipTransferResult, AssetImageExternalInput, AssetImageUpdateInput, AssetImageUploadInput, SimulationPlace, WorldChildCreate, WorldChildren, WorldChildProjection, WorldChildUpdate } from './contracts';
import type { AssetImage, AssetListResponse, AssetQuery, LibraryAssetCreate, LibraryOverview } from '../types/library';
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

  async listWorldChildren(worldId: string): Promise<WorldChildren> {
    await pause();
    const grouped: WorldChildren = { locations: [], species: [], factions: [], societies: [], families: [], memories: [] };
    const keys = { place: 'locations', species: 'species', faction: 'factions', society: 'societies', family: 'families', memory: 'memories' } as const;
    for (const asset of fixtures.filter((item) => item.originWorldId === worldId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
      const key = keys[asset.type as keyof typeof keys];
      if (!key) continue;
      const document = { ...(asset.document ?? {}) };
      const worldEntryId = typeof document.worldEntryId === 'string' ? document.worldEntryId : asset.id;
      delete document.worldEntryId;
      const titleField = asset.type === 'memory' ? 'title' : 'name';
      grouped[key].push({ ...document, id: worldEntryId, libraryAssetId: asset.id, [titleField]: asset.name } as WorldChildProjection);
    }
    return grouped;
  }

  createWorldChild(worldId: string, asset: WorldChildCreate) {
    return this.createAsset({ ...asset, originWorldId: worldId });
  }

  updateWorldChild(_worldId: string, childId: string, update: WorldChildUpdate) {
    return this.updateAsset(childId, update as LibraryAssetUpdate);
  }

  async moveWorldChild(worldId: string, childId: string, parentLocationId: string | null) {
    const asset = await this.getAsset(childId);
    if (asset.originWorldId !== worldId || asset.type !== 'place') throw new Error(`World child not found: ${childId}`);
    const document = { ...(asset.document ?? {}) };
    if (parentLocationId) document.parentLocationId = parentLocationId;
    else delete document.parentLocationId;
    return this.updateAsset(childId, { document } as LibraryAssetUpdate);
  }

  async deleteWorldChild(worldId: string, childId: string) {
    const asset = fixtures.find((item) => item.id === childId);
    if (!asset || asset.originWorldId !== worldId) throw new Error(`World child not found: ${childId}`);
    await this.deleteAsset(childId);
  }

  async createAsset(asset: LibraryAssetCreate) {
    await pause();
    const now = new Date().toISOString();
    const created = {
      id: crypto.randomUUID(),
      type: asset.type,
      name: asset.name,
      summary: asset.summary ?? '',
      originWorldId: asset.originWorldId ?? undefined,
      createdAt: now,
      updatedAt: now,
      sourceType: 'user-created' as const,
      contentRating: asset.contentRating ?? 'sfw' as const,
      tags: asset.tags ?? [],
      dependencyCount: 0,
      visualTone: asset.visualTone ?? 'moon' as const,
      document: asset.document ?? {},
      canEdit: true,
      isOwner: true,
    };
    fixtures.unshift(created);
    return created;
  }

  async updateAsset(id: string, update: LibraryAssetUpdate) {
    await pause();
    const asset = fixtures.find((item) => item.id === id);
    if (!asset) throw new Error(`Asset not found: ${id}`);
    Object.assign(asset, update, { updatedAt: new Date().toISOString() });
    return asset;
  }

  async getDeleteImpact(id: string) {
    await pause();
    const children = fixtures.filter((item) => item.originWorldId === id);
    const byType: Record<string, number> = {};
    for (const child of children) byType[child.type] = (byType[child.type] ?? 0) + 1;
    return { totalChildren: children.length, byType };
  }

  async deleteAsset(id: string, options: { cascade?: boolean; confirmName?: string } = {}) {
    await pause();
    const index = fixtures.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Asset not found: ${id}`);
    const asset = fixtures[index];
    const children = fixtures.filter((item) => item.originWorldId === id);
    if (children.length && !options.cascade) throw new Error(`This world still contains ${children.length} connected records.`);
    if (children.length && options.confirmName !== asset.name) throw new Error('World-name confirmation did not match.');
    if (options.cascade) {
      for (let childIndex = fixtures.length - 1; childIndex >= 0; childIndex -= 1) {
        if (fixtures[childIndex].originWorldId === id) fixtures.splice(childIndex, 1);
      }
    }
    const finalIndex = fixtures.findIndex((item) => item.id === id);
    fixtures.splice(finalIndex, 1);
  }

  async searchOwnershipTransferTargets(_id: string, _search: string) {
    await pause();
    return [];
  }

  async transferWorldOwnership(
    _id: string,
    _input: { targetUserId: string; confirmName: string },
  ): Promise<OwnershipTransferResult> {
    throw new Error('Ownership transfer requires the live Orbis API.');
  }

  async listSimulationPersonas() {
    return [];
  }

  async listSimulationPlaces(id: string): Promise<SimulationPlace[]> {
    await pause();
    const target = fixtures.find((item) => item.id === id);
    if (!target) return [];
    const worldId = target.type === 'world' ? target.id : target.originWorldId;
    return fixtures
      .filter((item) => item.type === 'place' && (worldId ? item.originWorldId === worldId : item.id === target.id))
      .sort((a, b) => (a.id === target.id ? -1 : b.id === target.id ? 1 : a.name.localeCompare(b.name)))
      .map((item) => {
        const document = item.document ?? {};
        return {
          id: item.id,
          name: item.name,
          summary: item.summary,
          kind: typeof document.kind === 'string' ? document.kind : undefined,
          parentLocationId: typeof document.parentLocationId === 'string' ? document.parentLocationId : undefined,
          isTarget: item.id === target.id,
        };
      });
  }

  async simulateAsset(_id: string, _personaId: string, _startingPlaceId?: string): Promise<{ launchUrl: string; expiresAt: number }> {
    throw new Error('Speculus launches require the live Orbis API.');
  }

  async listAssetImages(_assetId: string): Promise<AssetImage[]> {
    await pause();
    return [];
  }

  async uploadAssetImage(_assetId: string, _input: AssetImageUploadInput): Promise<AssetImage> {
    throw new Error('Image uploads require the live Orbis API.');
  }

  async addExternalAssetImage(_assetId: string, _input: AssetImageExternalInput): Promise<AssetImage> {
    throw new Error('External image links require the live Orbis API.');
  }

  async updateAssetImage(_assetId: string, _imageId: string, _update: AssetImageUpdateInput): Promise<AssetImage> {
    throw new Error('Image changes require the live Orbis API.');
  }

  async removeAssetImage(_assetId: string, _imageId: string): Promise<void> {
    throw new Error('Image removal requires the live Orbis API.');
  }
}
