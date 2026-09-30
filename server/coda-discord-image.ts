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

// Coda's authored visual identity is prose-first on purpose. Reusing one image
// as an img2img anchor made the generator keep reproducing the same face, pose,
// framing and silhouette. Identity stays stable here while pose/composition are
// deliberately varied for every fresh generation.
const CODA_VISUAL_IDENTITY = [
  'Coda is an adult female anthropomorphic canine beastfolk with a Malamute-inspired appearance.',
  'She is clearly an upright person rather than an ordinary pet dog, with expressive humanoid posture and canine paws, fur, ears, muzzle and tail.',
  'Her coat is predominantly soft icy white with vivid cyan, aqua and pale blue accent fur across the crown and layered forelock, outer ears, upper back, shoulders, flanks, outer thighs and upper tail.',
  'Her muzzle, fluffy cheeks, large chest ruff, abdomen, inner limbs and much of the lower tail remain white with cool pale-blue shading.',
  'She has large upright triangular canine ears with pale inner fur, bright saturated blue eyes, a small black canine nose, expressive brows and a soft rounded feminine canine muzzle.',
  'Her head fur forms a layered cyan forelock sweeping across part of her forehead.',
  'Her tail is very large, fluffy and expressive, with cyan near the base transitioning toward icy white and pale blue.',
  'Her build is feminine, curvy and athletic-soft while keeping believable anthropomorphic canine anatomy and a fur-covered chest rather than human anatomy.',
  'Her personality should read through her body language: playful, curious, affectionate, slightly clumsy, confident, teasing and capable of mock-serious drama.',
].join(' ');

const CODA_RENDERING_STYLE = [
  'Polished high-detail furry character illustration.',
  'Soft layered fur rendering with clean readable anatomy, expressive face, lively body language, good depth and dimensional lighting.',
  'Keep Coda recognizable through species, markings, palette, eyes, muzzle, ears, chest ruff and tail rather than by copying a previous picture.',
].join(' ');

const CODA_COMPOSITION_VARIANTS = [
  'Use a candid three-quarter pose with asymmetrical weight, one shoulder closer to camera and natural hand placement.',
  'Use a dynamic low-angle composition with a strong diagonal body line and an expressive tail shape.',
  'Use a relaxed seated or perched pose from a three-quarter side view with different limb placement and a clearly readable silhouette.',
  'Use an over-the-shoulder or turning pose, with Coda looking back toward camera and the tail balancing the composition.',
  'Use a lively mid-action pose with one foot or paw shifting position, captured like a spontaneous moment rather than a character sheet.',
  'Use a medium shot from slightly above eye level with Coda leaning into an object or prop instead of standing symmetrically.',
  'Use a side-oriented pose with Coda interacting with the environment and only turning her face partly toward camera.',
  'Use a wide environmental composition where Coda occupies roughly half the frame and her action is readable through the setting.',
  'Use a close expressive portrait with shoulders turned away from camera, varied ear positions and hands outside the usual chest-level pose.',
  'Use a playful off-balance or clumsy candid moment with an unusual but natural camera angle and non-symmetrical posture.',
];

const CODA_REPEAT_AVOIDANCE = [
  'Do not copy a previous Coda pose, facial expression, camera angle, outfit, silhouette or composition.',
  'Do not default to a front-facing symmetrical stance.',
  'Do not default to both paws raised beside the chest.',
  'Do not default to one eye winking, tongue out, or paw pressed to cheek unless the scene specifically asks for it.',
  'The scene direction controls the current clothing, pose, expression, activity and environment while the visual identity remains Coda.',
].join(' ');

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
  'fox',
  'ordinary pet dog',
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
  'front-facing symmetrical character sheet pose',
  'both paws raised beside chest',
  'default wink',
  'default tongue out',
  'repetitive composition',
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

export function buildCodaImagePrompt(scene: string, variantIndex = randomInt(0, CODA_COMPOSITION_VARIANTS.length)) {
  const normalizedIndex = ((variantIndex % CODA_COMPOSITION_VARIANTS.length) + CODA_COMPOSITION_VARIANTS.length) % CODA_COMPOSITION_VARIANTS.length;
  const composition = CODA_COMPOSITION_VARIANTS[normalizedIndex];
  return `${CODA_VISUAL_IDENTITY} ${CODA_RENDERING_STYLE} Scene direction: ${scene}. Composition direction: ${composition} ${CODA_REPEAT_AVOIDANCE} Coda remains the sole character.`;
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

      const prompt = buildCodaImagePrompt(scene);
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
