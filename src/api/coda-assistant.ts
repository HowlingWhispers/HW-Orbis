export type CodaMode = 'guide' | 'sort' | 'inspect';
export type CodaHistoryTurn = { role: 'user' | 'assistant'; content: string };

export interface CodaProposal {
  type: 'world' | 'character' | 'place' | 'item' | 'faction' | 'species' | 'society' | 'family' | 'memory';
  name: string;
  confidence: 'high' | 'medium' | 'low';
  reason?: string;
  fields?: Record<string, unknown>;
}

/** A structured operation Coda wants Orbis to perform. It is not a write until Orbis confirms it. */
export interface CodaOperation {
  op: 'create' | 'update';
  type?: CodaProposal['type'];
  targetRecordId?: string;
  name?: string;
  summary?: string;
  contentRating?: 'sfw' | 'adult';
  tags?: string[];
  visualTone?: 'moon' | 'forest' | 'ember' | 'mist' | 'violet' | 'river';
  fields?: Record<string, unknown>;
}

/** The authoritative outcome of one operation, produced by the Orbis runtime. */
export interface CodaWriteResult {
  index: number;
  status: 'applied' | 'rejected' | 'failed';
  operation: 'create' | 'update';
  requestedName: string;
  recordId: string | null;
  recordType: string | null;
  revision: number | null;
  changedFields: string[];
  originWorldId: string | null;
  contentRating: string | null;
  message: string;
  code?: string;
}

export interface CodaAssistantResponse {
  mode: CodaMode;
  model?: string;
  recovered?: boolean;
  text?: string;
  summary?: string;
  modelSummary?: string;
  intent?: 'propose' | 'apply';
  proposals?: CodaProposal[];
  operations?: CodaOperation[];
  pendingOperations?: number;
  questions?: string[];
  warnings?: string[];
  /** Unsaved editor draft. Never an executed action. */
  recordPatch?: Record<string, unknown> | null;
  writeResults?: CodaWriteResult[];
  writeReport?: string;
  savedCount?: number;
  failedCount?: number;
  /** Correlates this reply with the server-side per-user Coda debugging log. */
  requestId?: string;
  record?: { id: string; type: string; name: string; originWorldId?: string; canAddToWorld?: boolean };
}

export class CodaAssistantError extends Error {
  constructor(message: string, public readonly settingsPath?: string) {
    super(message);
    this.name = 'CodaAssistantError';
  }
}

export async function askCoda(input: {
  mode: CodaMode;
  text: string;
  assetId?: string;
  includeRecordContext?: boolean;
  pageHint?: string;
  history?: CodaHistoryTurn[];
  applyOperations?: boolean;
  contentRating?: 'sfw' | 'adult';
}) {
  const response = await fetch('/api/coda-assistant', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({})) as CodaAssistantResponse & { error?: string; settingsPath?: string };
  const requestId = response.headers.get('x-request-id') ?? undefined;
  if (!response.ok) throw new CodaAssistantError(data.error ?? 'Coda could not complete that request.', data.settingsPath);
  return requestId ? { ...data, requestId } : data;
}

/** Runs Coda's operations through the Orbis runtime. Results are the only source of truth. */
export async function runCodaOperations(input: { operations: CodaOperation[]; originWorldId?: string | null }) {
  const response = await fetch('/api/coda-assistant/execute', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({})) as {
    writeResults?: CodaWriteResult[];
    writeReport?: string;
    summary?: string;
    savedCount?: number;
    failedCount?: number;
    error?: string;
  };
  if (!response.ok) {
    return {
      writeResults: data.writeResults ?? [],
      writeReport: data.writeReport ?? data.error ?? 'Nothing was saved. Orbis refused the operation set.',
      savedCount: 0,
      failedCount: data.writeResults?.length ?? 0,
    };
  }
  return {
    writeResults: data.writeResults ?? [],
    writeReport: data.writeReport ?? '',
    summary: data.summary ?? '',
    savedCount: data.savedCount ?? 0,
    failedCount: data.failedCount ?? 0,
  };
}
