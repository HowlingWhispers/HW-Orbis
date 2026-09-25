export type CodaMode = 'guide' | 'sort' | 'inspect';

export interface CodaProposal {
  type: 'world' | 'character' | 'place' | 'item' | 'faction' | 'species' | 'society' | 'family' | 'memory';
  name: string;
  confidence: 'high' | 'medium' | 'low';
  reason?: string;
  fields?: Record<string, unknown>;
}

export interface CodaAssistantResponse {
  mode: CodaMode;
  model?: string;
  text?: string;
  summary?: string;
  proposals?: CodaProposal[];
  questions?: string[];
  warnings?: string[];
  recordPatch?: Record<string, unknown> | null;
  record?: { id: string; type: string; name: string; originWorldId?: string; canAddToWorld?: boolean };
}

export class CodaAssistantError extends Error {
  constructor(message: string, public readonly settingsPath?: string) {
    super(message);
    this.name = 'CodaAssistantError';
  }
}

export async function askCoda(input: { mode: CodaMode; text: string; assetId?: string; includeRecordContext?: boolean; pageHint?: string }) {
  const response = await fetch('/api/coda-assistant', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({})) as CodaAssistantResponse & { error?: string; settingsPath?: string };
  if (!response.ok) throw new CodaAssistantError(data.error ?? 'Coda could not complete that request.', data.settingsPath);
  return data;
}
