/**
 * Classification of an upstream provider failure for the Discord Coda bridge.
 *
 * The bridge previously discarded the upstream body and kept only the HTTP
 * status, which made every NovelAI 400 indistinguishable. It matters a great
 * deal: "your tier cannot use this model" is a reason to try a different
 * credential, while "your request is malformed" is a bug in our own code and
 * must never be hidden by quietly spending someone else's key on it.
 *
 * Nothing here stores or returns a credential. The sanitised reason keeps only
 * a bounded excerpt of the provider's own message with token-shaped strings
 * removed, because that message is written for a human operator and is the only
 * useful diagnostic we have.
 */

export type ProviderFailureClass =
  | 'entitlement_denied'
  | 'invalid_credential'
  | 'rate_limited'
  | 'malformed_request'
  | 'provider_unavailable'
  | 'unknown_upstream';

/**
 * Failures where a different credential would plausibly succeed, so the
 * Discord Coda workload may fall back to the shared pool.
 *
 * `rate_limited` is deliberately excluded: a personal key hitting its own
 * limit is that account's limit, and answering it by spending another member's
 * allowance would be abusive. `malformed_request` is excluded because
 * rotating cannot fix a request this code built wrongly, and doing so would
 * disguise our bug. `provider_unavailable` is excluded for the same reason.
 */
export const POOL_FALLBACK_ELIGIBLE: ReadonlySet<ProviderFailureClass> = new Set<ProviderFailureClass>([
  'entitlement_denied',
  'invalid_credential',
]);

export function isPoolFallbackEligible(failureClass: ProviderFailureClass) {
  return POOL_FALLBACK_ELIGIBLE.has(failureClass);
}

export type ProviderFailure = {
  status: number;
  failureClass: ProviderFailureClass;
  /** Bounded, token-free excerpt of the provider message, for operator logs. */
  reason: string;
};

const MAX_REASON = 240;

function sanitizeReason(body: unknown, rawText: string) {
  let text = '';
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.detail;
    if (typeof message === 'string') text = message;
  }
  if (!text) text = rawText;
  // Strip anything token-shaped before the text can reach a log or a response.
  return text
    .replace(/\b(?:Bearer|sk|nvs|token|key)[-_a-zA-Z0-9]{8,}/gi, '[redacted]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_REASON);
}

/**
 * Order matters. The entitlement check must run before the generic
 * "bad request" check, because the observed entitlement rejection is itself an
 * HTTP 400 whose message also contains the word "bad request".
 *
 * The endpoint check must also run early: "not available via OpenAI-compatible
 * API" mentions neither entitlement nor auth, but it is a defect in how we
 * address the provider rather than anything about the credential.
 */
function classifyMessage(message: string, status: number): ProviderFailureClass {
  const text = message.toLowerCase();

  if (/not allowed for current user tier|not allowed for your tier|current user tier|user tier|subscription tier|not available for your (?:subscription|plan|tier)|does not have access|not entitled/.test(text)) {
    return 'entitlement_denied';
  }
  if (/not available via openai-compatible api|use main novelai api/.test(text)) {
    // We are calling a model through an endpoint that does not serve it. That is
    // our request construction, so it must never be papered over by rotation.
    return 'malformed_request';
  }
  if (/unauthorized|invalid token|token (?:is )?expired|invalid api key|incorrect api key|api key (?:is )?invalid|authentication/.test(text)) {
    return 'invalid_credential';
  }
  if (/rate limit|too many requests|quota|too many tokens|insufficient_?quota|exceeded your current quota/.test(text)) {
    return 'rate_limited';
  }
  if (/temporarily unavailable|service unavailable|overloaded|maintenance|try again later|upstream/.test(text)) {
    return 'provider_unavailable';
  }
  if (/doesn'?t exist|does not exist|unknown model|bad request|invalid request|unsupported|not supported|validation/.test(text)) {
    return 'malformed_request';
  }

  if (status === 401 || status === 403) return 'invalid_credential';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422) return 'malformed_request';
  if (status >= 500) return 'provider_unavailable';
  return 'unknown_upstream';
}

export function classifyProviderFailure(status: number, body: unknown, rawText = ''): ProviderFailure {
  const reason = sanitizeReason(body, rawText);
  return { status, failureClass: classifyMessage(reason, status), reason };
}
