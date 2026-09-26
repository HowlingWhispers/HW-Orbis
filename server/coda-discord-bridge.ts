import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import { buildCodaPrompt } from './coda-assistant.js';
import { credentialKey, openCredential } from './provider-settings.js';

const requestSchema = z.object({
  discordUserId: z.string().regex(/^\d{17,20}$/),
  text: z.string().trim().min(1).max(4_000),
}).strict();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function extractNovelAiText(value: unknown) {
  const choices = asRecord(value).choices;
  if (!Array.isArray(choices)) return '';
  const first = asRecord(choices[0]);
  if (typeof first.text === 'string' && first.text.trim()) return first.text.trim();
  const parsedContent = first.parsedContent ?? first.parsed_content;
  if (typeof parsedContent === 'string' && parsedContent.trim()) return parsedContent.trim();
  const message = asRecord(first.message);
  return typeof message.content === 'string' ? message.content.trim() : '';
}

function bridgeAuthorized(config: AppConfig, authorization: string | undefined) {
  if (!config.CODA_INTERNAL_BRIDGE_SECRET) return false;
  return authorization === `Bearer ${config.CODA_INTERNAL_BRIDGE_SECRET}`;
}

export function createCodaDiscordBridgeRouter(config: AppConfig, pool: DatabasePool) {
  const router = Router();

  router.post('/', async (request, response, next) => {
    try {
      if (!config.CODA_INTERNAL_BRIDGE_SECRET) {
        return response.status(503).json({
          code: 'bridge_not_configured',
          error: 'Coda is not connected to Orbis yet. The server bridge secret is missing.',
        });
      }
      if (!bridgeAuthorized(config, request.get('authorization'))) {
        return response.status(401).json({ code: 'bridge_unauthorized', error: 'Coda bridge authorization failed.' });
      }

      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ code: 'invalid_request', error: 'Coda could not read that Discord request.' });
      }

      const { discordUserId, text } = parsed.data;
      const userResult = await pool.query(
        `SELECT id::text, display_name
         FROM users
         WHERE discord_id = $1
         LIMIT 1`,
        [discordUserId],
      );
      if (!userResult.rowCount) {
        return response.status(404).json({
          code: 'orbis_account_not_linked',
          error: "🐾 I can't match this Discord account to Orbis yet. Sign in to Orbis with this Discord account first, then try /coda again.",
        });
      }

      const user = userResult.rows[0];
      const providerResult = await pool.query(
        `SELECT model, token_ciphertext, token_iv, token_tag
         FROM user_provider_settings
         WHERE user_id = $1 AND provider = 'novelai'
         LIMIT 1`,
        [user.id],
      );
      if (!providerResult.rowCount) {
        return response.status(409).json({
          code: 'missing_novelai_key',
          error: '🐾 I found your Orbis account, but you do not have a NovelAI key connected yet. Add your NovelAI key in Orbis → Account, then try /coda again.',
          settingsPath: '/account',
        });
      }

      const provider = providerResult.rows[0];
      const token = openCredential({
        ciphertext: provider.token_ciphertext,
        iv: provider.token_iv,
        tag: provider.token_tag,
      }, credentialKey(config.ORBIS_CREDENTIAL_ENCRYPTION_KEY));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180_000);
      try {
        const upstream = await fetch('https://text.novelai.net/oa/v1/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: String(provider.model),
            prompt: buildCodaPrompt('guide', text, undefined, 'Discord /coda', false, []),
            max_tokens: 1100,
            temperature: 0.45,
            top_k: 180,
            top_p: 0.9,
            frequency_penalty: 0.15,
            presence_penalty: 0,
            stream: false,
            stop: ['\nUSER INPUT:', '\nCODA ASSISTANT / ORBIS'],
          }),
          signal: controller.signal,
        });

        const payload = await upstream.json().catch(() => undefined);
        if (!upstream.ok) {
          if (upstream.status === 401 || upstream.status === 403) {
            return response.status(409).json({
              code: 'novelai_key_rejected',
              error: '🐾 I found your NovelAI key in Orbis, but NovelAI rejected it. Update the key in Orbis → Account and try again.',
            });
          }
          if (upstream.status === 429) {
            return response.status(503).json({
              code: 'novelai_rate_limited',
              error: '🐾 NovelAI is rate-limiting this request right now. Give my paws a moment and try /coda again.',
            });
          }
          return response.status(502).json({
            code: 'novelai_upstream_error',
            error: `🐾 NovelAI returned an error (${upstream.status}). Nothing is wrong with your Discord link; try again shortly.`,
          });
        }

        const reply = extractNovelAiText(payload);
        if (!reply) {
          return response.status(502).json({
            code: 'novelai_empty_reply',
            error: '🐾 NovelAI answered with an empty response. Try /coda again.',
          });
        }

        return response.json({ ok: true, reply, model: String(provider.model), orbisUser: String(user.display_name ?? '') });
      } catch (error) {
        if (controller.signal.aborted) {
          return response.status(504).json({
            code: 'novelai_timeout',
            error: '🐾 NovelAI took too long to answer. Try /coda again in a moment.',
          });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      next(error);
    }
  });

  return router;
}
