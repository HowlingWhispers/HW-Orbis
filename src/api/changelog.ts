import type { PublicChangelogEntry, PublicChangelogPayload } from '../types/changelog';

const CHANGELOG_PATH = '/v1/changelog';

/**
 * The published changelog is public, so it needs no session and no library
 * access. These helpers throw on failure like the rest of the client; callers
 * that run during app entry are responsible for catching, because a changelog
 * outage must never block the Library.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) throw new Error('Orbis could not load the changelog.');
  return response.json() as Promise<T>;
}

export function fetchPublicChangelog(signal?: AbortSignal): Promise<PublicChangelogPayload> {
  return request<PublicChangelogPayload>(`/api${CHANGELOG_PATH}`, { signal });
}

export function fetchChangelogAcknowledgement(signal?: AbortSignal) {
  return request<{ version: string; available: boolean }>(`/api${CHANGELOG_PATH}/acknowledgement`, { signal });
}

export function acknowledgeChangelog(version: string) {
  return request<{ version: string; available: boolean }>(`/api${CHANGELOG_PATH}/acknowledgement`, {
    method: 'PUT',
    body: JSON.stringify({ version }),
  });
}

export type { PublicChangelogEntry, PublicChangelogPayload };

