import { appConfig } from '../config/env';

export type SaveCompatibility = 'ready' | 'historical-revision-required' | 'incompatible';
export interface ArchivedSave {
  id: string;
  worldId: string | null;
  worldName: string;
  sourceAssetId: string;
  sourceType: string;
  sourceRevision: string;
  sourceName: string;
  title: string;
  characterId: string | null;
  characterName: string | null;
  locationId: string | null;
  locationName: string | null;
  elapsedSeconds: number;
  simulationDay: number;
  turnCount: number;
  format: string;
  compatibility: SaveCompatibility;
  createdAt: string;
  updatedAt: string;
}

export interface SaveArchiveResponse {
  world: { id: string; name: string };
  saves: ArchivedSave[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${appConfig.apiBaseUrl}/v1/library${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Save archive request failed with status ${response.status}.`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export const saveArchiveApi = {
  list(worldId: string, signal?: AbortSignal) {
    return request<SaveArchiveResponse>(`/assets/${encodeURIComponent(worldId)}/saves`, { signal });
  },
  upload(worldId: string, save: unknown, title?: string) {
    return request<ArchivedSave>(`/assets/${encodeURIComponent(worldId)}/saves`, {
      method: 'POST', body: JSON.stringify({ save, ...(title?.trim() ? { title: title.trim() } : {}) }),
    });
  },
  rename(id: string, title: string) {
    return request<ArchivedSave>(`/saves/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) });
  },
  duplicate(id: string) {
    return request<ArchivedSave>(`/saves/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
  },
  remove(id: string) {
    return request<void>(`/saves/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  downloadUrl(id: string) {
    return `${appConfig.apiBaseUrl}/v1/library/saves/${encodeURIComponent(id)}/download`;
  },
};
