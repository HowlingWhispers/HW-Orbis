import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import { credentialKey, openCredential } from './provider-settings.js';

const requestSchema = z.object({
  discordUserId: z.string().regex(/^\d{17,20}$/),
  scene: z.string().trim().min(1).max(1_500),
}).strict();

const CODA_IMAGE_MODEL = 'nai-diffusion-5-full';

// Coda's authored visual identity. Discord callers can describe the scene,
// clothing, pose, framing, mood or expression, but they cannot replace the
// subject. This route is intentionally a Coda generator, not a general image
// generation proxy.
const CODA_IDENTITY_PROMPT = [
  'fur dataset',
  'solo',
  'one character only',
  'adult anthro female canine',
  'Coda',
  'malamute-like canine beastfolk',
  'fluffy white fur with bright cyan and aqua markings',
  'cyan hair tuft and bangs',
  'bright blue eyes',
  'large fluffy canine tail',
  'soft rounded canine muzzle',
  'large triangular canine ears',
  'very fluffy chest fur',
  'canine chest anatomy',
  'no human breasts',
  'playful expressive mascot character',
  'soft polished furry illustration',
  'clean refined linework',
  'smooth soft shading',
  'high detail fluffy fur',
  'vibrant controlled cyan and white color identity',
  'good lighting and depth',
  'appealing proportions',
  'high quality public-posting illustration',
].join(', ');

const CODA_NEGATIVE_PROMPT = [
  'multiple characters',
  'two characters',
  'crowd',
  'other character',
  'human',
  'realistic human',
  'human skin',
  'human face',
  'human ears',
  'human breasts',
  'cleavage',
  'brown fur dominance',
  'black fur dominance',
  'duplicate character',
  'duplicate tail',
  'extra limbs',
  'extra arms',
  'extra legs',
  'extra head',
  'multiple heads',
  'malformed paws',
  'bad anatomy',
  'deformed anatomy',
  'low quality',
  'worst quality',
  'blurry',
  'muddy colors',
  'flat lighting',
  'flat shading',
  'text',
  'watermark',
  'signature',
].join(', ');

function bridgeAuthorized(config: AppConfig, authorization: string | undefined) {
  if (!config.CODA_INTERNAL_BRIDGE_SECRET) return false;
  return authorization === `Bearer ${config.CODA_INTERNAL_BRIDGE_SECRET}`;
}

function imagePrompt(scene: string) {
  // The variable text is framed as scene direction after Coda's locked identity.
  // Repeating the solo constraint at the end helps keep additional subjects out
  // even if a member writes a busy scene description.
  return `${CODA_IDENTITY_PROMPT}. Scene direction: ${scene}. Coda remains the sole character, same cyan-and-white Coda design, same polished furry illustration style.`;
}

export function createCodaDiscordImageRouter(config: AppConfig, pool: DatabasePool) {
  const router = Router();

  router.post('/', async (request, response, next) => {
    try {
      if (!config.CODA_INTERNAL_BRIDGE_SECRET) {
        return response.status(503).json({ error: 'Coda image generation is not connected to Orbis yet.' });
      }
      if (!bridgeAuthorized(config, request.get('authorization'))) {
        return response.status(401).json({ error: 'Coda image bridge authorization failed.' });
      }

      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: 'Coda could not read that image request.' });
      }

      const { discordUserId, scene } = parsed.data;
      const userResult = await pool.query(
        `SELECT id::text, display_name FROM users WHERE discord_id = $1 LIMIT 1`,
        [discordUserId],
      );
      const user = userResult.rows[0] as Record<string, unknown> | undefined;
      if (!user) {
        return response.status(409).json({
          error: '🐾 I can draw myself for you, but I need this Discord account linked to Orbis first so I can use your NovelAI connection.',
        });
      }

      // Image generation always uses the requester's own NovelAI credential.
      // The Discord text shared-key pool is deliberately not used: an image can
      // consume a different allowance/Anlas budget and must never silently spend
      // another member's image quota.
      const providerResult = await pool.query(
        `SELECT token_ciphertext, token_iv, token_tag
           FROM user_provider_settings
          WHERE user_id = $1 AND provider = 'novelai'
          LIMIT 1`,
        [String(user.id)],
      );
      if (!providerResult.rowCount) {
        return response.status(409).json({
          error: '🐾 I need your own NovelAI key connected in Orbis before I can draw myself in Discord.',
        });
      }

      const row = providerResult.rows[0] as Record<string, unknown>;
      const token = openCredential({
        ciphertext: row.token_ciphertext as Buffer,
        iv: row.token_iv as Buffer,
        tag: row.token_tag as Buffer,
      }, credentialKey(config.ORBIS_CREDENTIAL_ENCRYPTION_KEY));

      const prompt = imagePrompt(scene);
      const seed = randomInt(0, 2_147_483_647);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180_000);

      try {
        const upstream = await fetch('https://image.novelai.net/ai/generate-image', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            input: prompt,
            model: CODA_IMAGE_MODEL,
            action: 'generate',
            parameters: {
              params_version: 4,
              width: 832,
              height: 1216,
              scale: 5,
              sampler: 'k_euler_ancestral',
              steps: 23,
              seed,
              n_samples: 1,
              noise_schedule: 'karras',
              dynamic_thresholding: false,
              deliberate_euler_ancestral_bug: false,
              prefer_brownian: true,
              qualityToggle: true,
              image_format: 'webp',
              uc: CODA_NEGATIVE_PROMPT,
              negative_prompt: CODA_NEGATIVE_PROMPT,
              v4_prompt: {
                caption: { base_caption: prompt, char_captions: [] },
                use_coords: false,
                use_order: true,
              },
              v4_negative_prompt: {
                caption: { base_caption: CODA_NEGATIVE_PROMPT, char_captions: [] },
              },
            },
          }),
          signal: controller.signal,
        });

        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '');
          console.warn('[coda-image] NovelAI image request failed', upstream.status, detail.slice(0, 500));
          if (upstream.status === 401 || upstream.status === 403) {
            return response.status(503).json({ error: '🐾 NovelAI would not accept your image connection. Check your key or subscription in Orbis.' });
          }
          if (upstream.status === 429) {
            return response.status(429).json({ error: '🐾 NovelAI says my drawing paws are moving too fast. Try again shortly.' });
          }
          return response.status(502).json({ error: `🐾 NovelAI could not finish my picture (${upstream.status}).` });
        }

        const payload = await upstream.json().catch(() => undefined) as { images?: Array<{ image?: string; seed?: number }> } | undefined;
        const first = payload?.images?.[0];
        if (!first?.image) {
          return response.status(502).json({ error: '🐾 NovelAI returned from the art room without an image. Rude.' });
        }

        return response.json({
          ok: true,
          imageBase64: first.image,
          format: 'webp',
          model: CODA_IMAGE_MODEL,
          seed: first.seed ?? seed,
          scene,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return response.status(504).json({ error: '🐾 My picture took too long to draw and timed out. Try again.' });
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
