import { appConfig } from '../config/env';

export type WorldBrainRevision = {
  id: string;
  kind: 'custom';
  revisionNumber: number;
  source: string;
  notes: string;
  createdAt: string;
  publishedAt: string;
};

export type WorldBrainState = {
  mode: 'standard' | 'custom';
  selectedRevisionId: string | null;
  updatedAt: string | null;
  revisions: WorldBrainRevision[];
};

async function read<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'World Brain request failed.');
  return body;
}

const pathFor = (worldId: string) => `${appConfig.apiBaseUrl}/v1/library/assets/${encodeURIComponent(worldId)}/world-brain`;

export async function getWorldBrain(worldId: string) {
  return read<WorldBrainState>(await fetch(pathFor(worldId), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  }));
}

export async function publishWorldBrain(worldId: string, source: string, notes: string) {
  return read<{ mode: 'custom'; selectedRevisionId: string; revision: WorldBrainRevision }>(await fetch(`${pathFor(worldId)}/revisions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ source, notes }),
  }));
}

export async function selectWorldBrain(worldId: string, value: { mode: 'standard' } | { mode: 'custom'; revisionId: string }) {
  return read<{ mode: 'standard' | 'custom'; selectedRevisionId: string | null }>(await fetch(`${pathFor(worldId)}/binding`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(value),
  }));
}
