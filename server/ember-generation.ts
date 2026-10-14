/**
 * NovelAI narration for Ember.
 *
 * The NovelAI credential is decrypted ONLY inside Orbis for the checked Orbis
 * user. This route never sends credentials/models/grants to the Ember browser.
 * Transcripts are ephemeral and must never be logged or persisted here.
 */
import { credentialKey, openCredential } from './provider-settings.js';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';

export type EmberTurn = {
  source: 'player' | 'provider';
  mode: 'action' | 'speech' | 'thought' | 'narrator';
  text: string;
};

export type EmberContext = {
  userId: string;
  mode: 'sandbox' | 'character' | 'world';
  asset: null | { id: string; type: 'character' | 'world'; name: string; summary: string };
};

export class EmberGenerationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

const supportedModels = new Set(['xialong-v1', 'glm-4-6']);
const stop = ['\nPLAYER:', '\nPLAYER (', '\nPlayer:', '\nUSER:', '\n<|user|>', '\nSystem:', '\nAnalysis:', '\nThinking:'];

export function buildEmberPrompt(context: EmberContext, turns: EmberTurn[], appFormattingGuidance = "") {
  const safeSummary = context.asset?.summary?.slice(0, 3500) || '(no summary provided)';
  const focus = context.mode === 'character'
    ? `Character roleplay. Portray ${context.asset!.name} consistently and respond directly as that character, including natural actions. The Orbis character description is: ${safeSummary}.`
    : context.mode === 'world'
      ? `World adventure set in ${context.asset!.name}. Existing Orbis world summary: ${safeSummary}. Preserve this canon: do not create named locations or definitive lore that was not provided. Unknown connections and places remain unknown.`
      : 'Blank freeform sandbox. No world, character, location, quest or opening scene is assumed. Build only on the player’s words and what has happened in the transcript.';
  const lines = turns.map((turn) => {
    const who = turn.source === 'player' ? 'PLAYER' : 'NARRATOR';
    // JSON encoding keeps multi-line story text distinguishable from role labels.
    return `${who}: ${JSON.stringify(turn.text)}`;
  });
  const header = [
    'EMBER / FREEFORM ROLEPLAY',
    'You are the in-world narration and character response engine for a private fictional story.',
    focus,
    'Continue the story naturally in English. Match the player’s tone, context and pacing.',
    'Do not decide what the player says, thinks or does. Do not impose missions, rules or game mechanics.',
    // App-specific formatting rules are owned by Ember and passed from its
    // trusted server through the authenticated internal bridge.
    ...(appFormattingGuidance ? [appFormattingGuidance] : []),
    'Do not include meta-commentary, analysis, system labels or quotation of the transcript.',
    'This is a roleplay response, not a JSON or markdown report.',
    'Recent story transcript (JSON-escaped text follows each role):',
  ].join('\n');
  const selected: string[] = [];
  let budget = 29_000 - header.length;
  // Prefer the newest context while keeping complete player/AI exchanges.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined || line.length > budget) break;
    selected.unshift(line);
    budget -= line.length + 1;
  }
  return `${header}\n${selected.join('\n')}\nNARRATOR:`;
}

// A companion discovery request uses app-authored guidance; Orbis does not
// define Ember's character rules, profiles, or roleplay markup.
export function buildEmberCompanionPrompt(turns: EmberTurn[], guidance: string) {
  const lines = turns.map(turn =>
    `${turn.source === 'player' ? 'PLAYER' : 'NARRATOR'}: ${JSON.stringify(turn.text)}`);
  const header = `${guidance}\nRecent story transcript follows (JSON-escaped text):`;
  const selected: string[] = [];
  let budget = 29_000 - header.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.length > budget) break;
    selected.unshift(line);
    budget -= line.length + 1;
  }
  return `${header}\n${selected.join('\n')}\nCODA RESULT:`;
}

function parseText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const list = (value as { choices?: unknown }).choices;
  const choice = Array.isArray(list) ? list[0] : null;
  if (!choice || typeof choice !== 'object') return '';
  const data = choice as { text?: unknown; parsedContent?: unknown; parsed_content?: unknown; message?: { content?: unknown } };
  const text = [data.text, data.parsedContent, data.parsed_content, data.message?.content]
    .find((field) => typeof field === 'string' && field.trim());
  return typeof text === 'string' ? text.trim() : '';
}

export async function generateEmberNarration(
  config: AppConfig, pool: DatabasePool, context: EmberContext, turns: EmberTurn[],
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
  appFormattingGuidance = "",
  task: 'narration' | 'discovery' = 'narration',
) {
  const provider = await pool.query(
    `SELECT model, token_ciphertext, token_iv, token_tag
     FROM user_provider_settings WHERE user_id = $1 AND provider = 'novelai'`,
    [context.userId],
  );
  if (!provider.rowCount) {
    throw new EmberGenerationError(409, 'NOVELAI_NOT_CONFIGURED',
      'Add your NovelAI key in Orbis Account settings to enable Ember narration.');
  }
  const entry = provider.rows[0];
  if (!supportedModels.has(String(entry.model))) {
    throw new EmberGenerationError(409, 'NOVELAI_MODEL_UNSUPPORTED',
      'The NovelAI model selected in Orbis is not supported by Ember yet.');
  }
  const token = openCredential({
    ciphertext: entry.token_ciphertext, iv: entry.token_iv, tag: entry.token_tag,
  }, credentialKey(config.ORBIS_CREDENTIAL_ENCRYPTION_KEY));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    let response: globalThis.Response;
    try {
      response = await fetchFn('https://text.novelai.net/oa/v1/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: entry.model,
          prompt: task === "discovery" ? buildEmberCompanionPrompt(turns, appFormattingGuidance) : buildEmberPrompt(context, turns, appFormattingGuidance),
          max_tokens: task === "discovery" ? 512 : 384, temperature: task === "discovery" ? 0.45 : 0.82, top_k: 250, top_p: 0.95,
          frequency_penalty: 0, presence_penalty: 0,
          stop, stream: false,
        }),
        signal: controller.signal,
      });
    } catch {
      throw new EmberGenerationError(controller.signal.aborted ? 504 : 502,
        controller.signal.aborted ? 'NOVELAI_TIMEOUT' : 'NOVELAI_NETWORK',
        controller.signal.aborted ? 'NovelAI timed out. Retry the last turn.' : 'Could not reach NovelAI. Retry the last turn.');
    }
    if (!response.ok) {
      // Never relay raw provider errors; they can include request internals.
      const status = response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 502 : 502;
      throw new EmberGenerationError(status, response.status === 429 ? 'NOVELAI_BUSY' : 'NOVELAI_UPSTREAM',
        response.status === 429 ? 'NovelAI is rate-limiting requests. Try again shortly.'
          : 'NovelAI could not generate a reply. Check your provider settings or retry.');
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new EmberGenerationError(502, 'NOVELAI_INVALID_RESPONSE', 'NovelAI returned an unreadable response.'); }
    const text = parseText(payload)
      .replace(/^(?:NARRATOR|ASSISTANT)\s*:\s*/i, '')
      .trim();
    if (!text) throw new EmberGenerationError(502, 'NOVELAI_EMPTY_REPLY', 'NovelAI returned an empty reply. Retry the last turn.');
    if (text.length > 32000) throw new EmberGenerationError(502, 'NOVELAI_OVERSIZED_REPLY', 'NovelAI response exceeded the supported length.');
    return { text, model: String(entry.model) };
  } finally {
    clearTimeout(timeout);
  }
}
