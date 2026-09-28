export type NovelAiSettings = {
  configured: boolean;
  model: 'xialong-v1' | 'glm-4-6';
  updatedAt?: string;
  /** Whether this connection may power Discord Coda for other members. */
  sharedUse?: boolean;
  /** False while the shared-use migration is not installed yet. */
  sharedUseAvailable?: boolean;
};

async function readSettingsResponse(response: Response): Promise<NovelAiSettings> {
  if (response.status === 204) return { configured: false, model: 'xialong-v1' };
  const data = await response.json() as NovelAiSettings & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Orbis could not save the provider settings.');
  return data;
}

export async function getNovelAiSettings() {
  return readSettingsResponse(await fetch('/api/provider-settings/novelai', { credentials: 'include', headers: { Accept: 'application/json' } }));
}

export async function saveNovelAiSettings(token: string, model: NovelAiSettings['model']) {
  return readSettingsResponse(await fetch('/api/provider-settings/novelai', {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token, model }),
  }));
}

export async function deleteNovelAiSettings() {
  return readSettingsResponse(await fetch('/api/provider-settings/novelai', { method: 'DELETE', credentials: 'include' }));
}

/**
 * Explicit consent to let this connection serve Discord Coda for other people.
 * Off by default and revocable at any time, which never removes the token.
 */
export async function setNovelAiSharedUse(enabled: boolean) {
  const response = await fetch('/api/provider-settings/novelai/shared-use', {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  const data = await response.json() as { sharedUse?: boolean; error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Orbis could not save that choice.');
  return { sharedUse: Boolean(data.sharedUse) };
}
