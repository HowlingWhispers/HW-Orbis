export type PlayerPronouns = 'he/him' | 'she/her' | 'they/them' | 'it/its';
export type ResponseLengthMode = 'concise' | 'normal' | 'long' | 'adaptive';

export type RuntimePreferences = {
  pronouns: PlayerPronouns | null;
  responseLength: ResponseLengthMode;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Runtime preferences could not be loaded.');
  return body;
}

export async function getRuntimePreferences(): Promise<RuntimePreferences> {
  return readJson<RuntimePreferences>(await fetch('/api/runtime-preferences', { credentials: 'include', headers: { Accept: 'application/json' } }));
}

export async function saveRuntimePreferences(preferences: RuntimePreferences): Promise<RuntimePreferences> {
  return readJson<RuntimePreferences>(await fetch('/api/runtime-preferences', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(preferences),
  }));
}
