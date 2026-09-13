// This is the public bridge error vocabulary. Never forward a provider response
// body: it may echo the prompt, credentials, or other private request data.
export const generationErrors = {
  NOVELAI_AUTH_FAILED: 'NovelAI rejected the saved access token. Update it in Orbis Account settings.',
  NOVELAI_ACCESS_DENIED: 'NovelAI did not authorize this generation. Check your subscription and model access.',
  NOVELAI_MODEL_UNAVAILABLE: 'The selected NovelAI model is unavailable.',
  NOVELAI_RATE_LIMITED: 'NovelAI is receiving too many requests. Wait and try again.',
  NOVELAI_INVALID_REQUEST: 'NovelAI rejected the generation settings or context.',
  NOVELAI_UNAVAILABLE: 'NovelAI is temporarily unavailable.',
  NOVELAI_REJECTED: 'NovelAI rejected this generation request.',
  NOVELAI_EMPTY_REPLY: 'NovelAI returned an empty roleplay reply.',
  NOVELAI_INVALID_RESPONSE: 'NovelAI returned an unreadable response.',
  NOVELAI_TIMEOUT: 'NovelAI did not finish within 180 seconds. No reply was committed.',
  NOVELAI_NETWORK_FAILURE: 'Orbis could not reach NovelAI. Check the Orbis server connection.',
} as const;
export type GenerationErrorCode = keyof typeof generationErrors;

export function providerErrorCode(status: number): GenerationErrorCode {
  if (status === 401) return 'NOVELAI_AUTH_FAILED';
  if (status === 402 || status === 403) return 'NOVELAI_ACCESS_DENIED';
  if (status === 404) return 'NOVELAI_MODEL_UNAVAILABLE';
  if (status === 429) return 'NOVELAI_RATE_LIMITED';
  if (status === 400 || status === 413 || status === 422) return 'NOVELAI_INVALID_REQUEST';
  if (status >= 500) return 'NOVELAI_UNAVAILABLE';
  return 'NOVELAI_REJECTED';
}

const parameters = new Set(['model', 'prompt', 'max_tokens', 'temperature', 'top_k', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop', 'seed', 'stream']);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function rejectedParameter(value: unknown): string | undefined {
  const body = record(value);
  const candidates: unknown[] = [record(body.error).param, body.param];
  if (Array.isArray(body.detail)) {
    for (const detail of body.detail) {
      const location = record(detail).loc;
      if (Array.isArray(location)) candidates.push(...location);
    }
  }
  return candidates.find((param): param is string => typeof param === 'string' && parameters.has(param));
}

export function safeFinishReason(value: unknown): string | undefined {
  return typeof value === 'string' && ['stop', 'length', 'max_tokens', 'eos', 'content_filter', 'error'].includes(value) ? value : undefined;
}
