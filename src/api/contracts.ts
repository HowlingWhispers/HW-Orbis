import type { AssetListResponse, AssetQuery, LibraryAsset, LibraryAssetCreate, LibraryAssetUpdate, LibraryOverview } from '../types/library';

export interface DeleteImpact {
  totalChildren: number;
  byType: Record<string, number>;
}

export interface OwnershipTransferTarget {
  id: string;
  displayName: string;
  discordUsername: string;
  discordId: string;
  avatarUrl?: string;
}

export interface OwnershipTransferResult {
  worldId: string;
  worldName: string;
  childCount: number;
  transferredTo: OwnershipTransferTarget;
}

export interface LibraryApi {
  getOverview(signal?: AbortSignal): Promise<LibraryOverview>;
  listAssets(query?: AssetQuery, signal?: AbortSignal): Promise<AssetListResponse>;
  getAsset(id: string, signal?: AbortSignal): Promise<LibraryAsset>;
  createAsset(asset: LibraryAssetCreate): Promise<LibraryAsset>;
  updateAsset(id: string, update: LibraryAssetUpdate): Promise<LibraryAsset>;
  getDeleteImpact(id: string): Promise<DeleteImpact>;
  deleteAsset(id: string, options?: { cascade?: boolean; confirmName?: string }): Promise<void>;
  searchOwnershipTransferTargets(id: string, search: string): Promise<OwnershipTransferTarget[]>;
  transferWorldOwnership(id: string, input: { targetUserId: string; confirmName: string }): Promise<OwnershipTransferResult>;
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
