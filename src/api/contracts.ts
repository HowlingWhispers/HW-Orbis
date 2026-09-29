import type { AssetImage, AssetImageKind, AssetListResponse, AssetQuery, LibraryAsset, LibraryAssetCreate, LibraryAssetUpdate, LibraryOverview } from '../types/library';

export type WorldChildType = 'place' | 'species' | 'faction' | 'society' | 'family' | 'memory';
export type WorldChildProjection = Record<string, unknown> & { id: string; libraryAssetId: string };
export interface WorldChildren {
  locations: WorldChildProjection[];
  species: WorldChildProjection[];
  factions: WorldChildProjection[];
  societies: WorldChildProjection[];
  families: WorldChildProjection[];
  memories: WorldChildProjection[];
}
export type WorldChildCreate = Omit<LibraryAssetCreate, 'type' | 'originWorldId'> & { type: WorldChildType };
export type WorldChildUpdate = Partial<LibraryAssetUpdate>;

export interface DeleteImpact {
  totalChildren: number;
  byType: Record<string, number>;
}

export interface AssetImageUploadInput {
  kind: AssetImageKind;
  file: File;
  caption?: string;
  altText?: string;
  focalX?: number;
  focalY?: number;
}

export interface AssetImageExternalInput {
  kind: AssetImageKind;
  url: string;
  caption?: string;
  altText?: string;
  focalX?: number;
  focalY?: number;
}

export interface AssetImageUpdateInput {
  caption?: string | null;
  altText?: string | null;
  focalX?: number;
  focalY?: number;
  position?: number;
  kind?: AssetImageKind;
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

export type SimulationTone = 'world-default' | 'family-friendly' | 'mature' | 'adult-erotic';

export interface SimulationLaunchSetup {
  tone: SimulationTone;
  focusTags: string[];
  direction: string;
}

export interface SimulationPersona {
  id: string;
  name: string;
  summary: string;
  owned: boolean;
  age?: number;
  adultToneEligible: boolean;
}

export interface SimulationPlace {
  id: string;
  name: string;
  summary: string;
  kind?: string;
  parentLocationId?: string;
  isTarget: boolean;
}

export interface LibraryApi {
  getOverview(signal?: AbortSignal): Promise<LibraryOverview>;
  listAssets(query?: AssetQuery, signal?: AbortSignal): Promise<AssetListResponse>;
  getAsset(id: string, signal?: AbortSignal): Promise<LibraryAsset>;
  listWorldChildren(worldId: string, signal?: AbortSignal): Promise<WorldChildren>;
  createWorldChild(worldId: string, asset: WorldChildCreate): Promise<LibraryAsset>;
  updateWorldChild(worldId: string, childId: string, update: WorldChildUpdate): Promise<LibraryAsset>;
  moveWorldChild(worldId: string, childId: string, parentLocationId: string | null): Promise<LibraryAsset>;
  deleteWorldChild(worldId: string, childId: string): Promise<void>;
  createAsset(asset: LibraryAssetCreate): Promise<LibraryAsset>;
  updateAsset(id: string, update: LibraryAssetUpdate): Promise<LibraryAsset>;
  getDeleteImpact(id: string): Promise<DeleteImpact>;
  deleteAsset(id: string, options?: { cascade?: boolean; confirmName?: string }): Promise<void>;
  searchOwnershipTransferTargets(id: string, search: string): Promise<OwnershipTransferTarget[]>;
  transferWorldOwnership(id: string, input: { targetUserId: string; confirmName: string }): Promise<OwnershipTransferResult>;
  listSimulationPersonas(signal?: AbortSignal): Promise<SimulationPersona[]>;
  listSimulationPlaces(id: string, signal?: AbortSignal): Promise<SimulationPlace[]>;
  simulateAsset(id: string, personaId: string, startingPlaceId?: string): Promise<{ launchUrl: string; expiresAt: number }>;
  listAssetImages(assetId: string, signal?: AbortSignal): Promise<AssetImage[]>;
  uploadAssetImage(assetId: string, input: AssetImageUploadInput): Promise<AssetImage>;
  addExternalAssetImage(assetId: string, input: AssetImageExternalInput): Promise<AssetImage>;
  updateAssetImage(assetId: string, imageId: string, update: AssetImageUpdateInput): Promise<AssetImage>;
  removeAssetImage(assetId: string, imageId: string): Promise<void>;
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