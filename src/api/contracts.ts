import type { AssetListResponse, AssetQuery, LibraryAsset, LibraryAssetCreate, LibraryAssetUpdate, LibraryOverview } from '../types/library';

export interface LibraryApi {
  getOverview(signal?: AbortSignal): Promise<LibraryOverview>;
  listAssets(query?: AssetQuery, signal?: AbortSignal): Promise<AssetListResponse>;
  getAsset(id: string, signal?: AbortSignal): Promise<LibraryAsset>;
  createAsset(asset: LibraryAssetCreate): Promise<LibraryAsset>;
  updateAsset(id: string, update: LibraryAssetUpdate): Promise<LibraryAsset>;
  deleteAsset(id: string): Promise<void>;
  simulateAsset(id: string): Promise<{ launchUrl: string; expiresAt: number }>;
}

export class LibraryApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LibraryApiError';
  }
}
