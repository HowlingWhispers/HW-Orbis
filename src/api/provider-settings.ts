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

export type AllowedDiscordUser = { discordId: string; addedAt: string };
export type AllowedDiscordUsers = { allowed: AllowedDiscordUser[]; available?: boolean };

async function readAllowedResponse(response: Response): Promise<AllowedDiscordUsers> {
  const data = await response.json() as AllowedDiscordUsers & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Orbis could not read your trusted users.');
  return data;
}

/** The Discord accounts this owner permits to be served by their credential. */
export async function getAllowedDiscordUsers() {
  return readAllowedResponse(await fetch('/api/provider-settings/novelai/shared-use/allowed', {
    credentials: 'include', headers: { Accept: 'application/json' },
  }));
}

export async function addAllowedDiscordUser(discordId: string) {
  return readAllowedResponse(await fetch('/api/provider-settings/novelai/shared-use/allowed', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ discordId }),
  }));
}

export async function removeAllowedDiscordUser(discordId: string) {
  return readAllowedResponse(await fetch(`/api/provider-settings/novelai/shared-use/allowed/${encodeURIComponent(discordId)}`, {
    method: 'DELETE', credentials: 'include', headers: { Accept: 'application/json' },
  }));
}

/**
 * Master consent for the shared pool. The tick alone shares with nobody: a
 * credential only serves the accounts named in the trusted-user list above.
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
