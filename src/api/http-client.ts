import type { LibraryApi, DeleteImpact, OwnershipTransferResult, OwnershipTransferTarget, AssetImageExternalInput, AssetImageUpdateInput, AssetImageUploadInput } from './contracts';
import { LibraryApiError } from './contracts';
import type { AssetImage, AssetListResponse, AssetQuery, LibraryAsset, LibraryAssetCreate, LibraryAssetUpdate, LibraryOverview } from '../types/library';

export class HttpLibraryApi implements LibraryApi {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        signal,
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new LibraryApiError(data.error ?? `Library request failed with status ${response.status}.`, response.status);
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof LibraryApiError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      throw new LibraryApiError('The Library service could not be reached.', undefined, error);
    }
  }

  private async send<T>(path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new LibraryApiError(data.error ?? `Library request failed with status ${response.status}.`, response.status);
    return data;
  }

  getOverview(signal?: AbortSignal) {
    return this.request<LibraryOverview>('/v1/library/overview', signal);
  }

  listAssets(query: AssetQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => value && params.set(key, value));
    const suffix = params.size ? `?${params}` : '';
    return this.request<AssetListResponse>(`/v1/library/assets${suffix}`, signal);
  }

  getAsset(id: string, signal?: AbortSignal) {
    return this.request<LibraryAsset>(`/v1/library/assets/${encodeURIComponent(id)}`, signal);
  }

  async createAsset(asset: LibraryAssetCreate) {
    const response = await fetch(`${this.baseUrl}/v1/library/assets`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(asset),
    });
    const data = await response.json() as LibraryAsset & { error?: string };
    if (!response.ok) throw new LibraryApiError(data.error ?? `Library request failed with status ${response.status}.`, response.status);
    return data;
  }

  async updateAsset(id: string, update: LibraryAssetUpdate) {
    const response = await fetch(`${this.baseUrl}/v1/library/assets/${encodeURIComponent(id)}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(update),
    });
    const data = await response.json() as LibraryAsset & { error?: string };
    if (!response.ok) throw new LibraryApiError(data.error ?? `Library request failed with status ${response.status}.`, response.status);
    return data;
  }

  getDeleteImpact(id: string) {
    return this.request<DeleteImpact>(`/v1/library/assets/${encodeURIComponent(id)}/delete-impact`);
  }

  async deleteAsset(id: string, options: { cascade?: boolean; confirmName?: string } = {}) {
    const response = await fetch(`${this.baseUrl}/v1/library/assets/${encodeURIComponent(id)}`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(options),
    });
    if (response.ok) return;
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new LibraryApiError(data.error ?? `Library request failed with status ${response.status}.`, response.status);
  }

  async searchOwnershipTransferTargets(id: string, search: string) {
    const params = new URLSearchParams({ search });
    const response = await this.request<{ items: OwnershipTransferTarget[] }>(`/v1/library/assets/${encodeURIComponent(id)}/transfer-targets?${params}`);
    return response.items;
  }

  async transferWorldOwnership(id: string, input: { targetUserId: string; confirmName: string }) {
    const response = await fetch(`${this.baseUrl}/v1/library/assets/${encodeURIComponent(id)}/transfer`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => ({})) as OwnershipTransferResult & { error?: string };
    if (!response.ok) throw new LibraryApiError(data.error ?? `Library request failed with status ${response.status}.`, response.status);
    return data;
  }

  async simulateAsset(id: string) {
    const response = await fetch(`${this.baseUrl}/v1/library/assets/${encodeURIComponent(id)}/simulate`, {
      method: 'POST', credentials: 'include', headers: { Accept: 'application/json' },
    });
    const data = await response.json() as { launchUrl?: string; expiresAt?: number; error?: string; settingsPath?: string };
    if (!response.ok || !data.launchUrl || !data.expiresAt) throw new LibraryApiError(data.error ?? `Simulation launch failed with status ${response.status}.`, response.status);
    return { launchUrl: data.launchUrl, expiresAt: data.expiresAt };
  }

  private imagesPath(assetId: string) {
    return `/v1/library/assets/${encodeURIComponent(assetId)}/images`;
  }

  async listAssetImages(assetId: string, signal?: AbortSignal) {
    const data = await this.request<{ items: AssetImage[] }>(this.imagesPath(assetId), signal);
    return data.items;
  }

  async uploadAssetImage(assetId: string, input: AssetImageUploadInput) {
    // Local images travel as the raw request body: Orbis reads the format from
    // the bytes themselves and hard-caps the payload at 1 MB, so no multipart
    // parser and no client-supplied filename ever decide what is stored.
    const params = new URLSearchParams({ kind: input.kind });
    if (input.caption) params.set('caption', input.caption);
    if (input.altText) params.set('altText', input.altText);
    if (input.focalX !== undefined) params.set('focalX', String(input.focalX));
    if (input.focalY !== undefined) params.set('focalY', String(input.focalY));
    params.set('fileName', input.file.name);
    const response = await fetch(`${this.baseUrl}${this.imagesPath(assetId)}?${params}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': input.file.type || 'application/octet-stream' },
      body: input.file,
    });
    const data = await response.json().catch(() => ({})) as AssetImage & { error?: string };
    if (!response.ok) throw new LibraryApiError(data.error ?? `Image upload failed with status ${response.status}.`, response.status);
    return data;
  }

  async addExternalAssetImage(assetId: string, input: AssetImageExternalInput) {
    return this.send<AssetImage>(this.imagesPath(assetId), 'POST', { storageKind: 'external', ...input });
  }

  async updateAssetImage(assetId: string, imageId: string, update: AssetImageUpdateInput) {
    return this.send<AssetImage>(`${this.imagesPath(assetId)}/${encodeURIComponent(imageId)}`, 'PATCH', update);
  }

  async removeAssetImage(assetId: string, imageId: string) {
    await this.send<{ ok: boolean }>(`${this.imagesPath(assetId)}/${encodeURIComponent(imageId)}`, 'DELETE');
  }
}
