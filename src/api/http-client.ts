import type { LibraryApi } from './contracts';
import { LibraryApiError } from './contracts';
import type { AssetListResponse, AssetQuery, LibraryAsset, LibraryAssetUpdate, LibraryOverview } from '../types/library';

export class HttpLibraryApi implements LibraryApi {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        signal,
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) throw new LibraryApiError(`Library request failed with status ${response.status}.`, response.status);
      return await response.json() as T;
    } catch (error) {
      if (error instanceof LibraryApiError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      throw new LibraryApiError('The Library service could not be reached.', undefined, error);
    }
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

  async simulateAsset(id: string) {
    const response = await fetch(`${this.baseUrl}/v1/library/assets/${encodeURIComponent(id)}/simulate`, {
      method: 'POST', credentials: 'include', headers: { Accept: 'application/json' },
    });
    const data = await response.json() as { launchUrl?: string; expiresAt?: number; error?: string; settingsPath?: string };
    if (!response.ok || !data.launchUrl || !data.expiresAt) throw new LibraryApiError(data.error ?? `Simulation launch failed with status ${response.status}.`, response.status);
    return { launchUrl: data.launchUrl, expiresAt: data.expiresAt };
  }
}
