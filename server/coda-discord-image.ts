import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { resolveCodaAdultAccess } from './coda-adult-access.js';
import { inspectImage } from './coda-image-metadata.js';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import { credentialKey, openCredential } from './provider-settings.js';
import type { SettingsStore } from './settings.js';
import {
  codaRenderPreset,
  codaSfwNegativeTerms,
  isCodaRenderQuality,
  quoteCodaRender,
  sceneRequestsExplicitContent,
  type CodaImageRating,
  type CodaRenderQuote,
} from './coda-render-presets.js';

/**
 * `confirmed` is required, not optional.
 *
 * Generation spends the requester's own Anlas, so the bridge refuses anything
 * that has not been through the member-facing confirmation card. Keeping the
 * contract on the server side means a future caller cannot add a code path that
 * spends Anlas without the member having seen the quote.
 */
const requestSchema = z.object({
  discordUserId: z.string().regex(/^\d{17,20}$/),
  scene: z.string().trim().min(1).max(1_500),
  quality: z.string().trim().optional().default('standard'),
  rating: z.enum(['sfw', 'adult']).optional().default('sfw'),
  confirmed: z.literal(true),
}).strict();

const CODA_IMAGE_MODEL = 'nai-diffusion-5-full';

/**
 * Model identity is owned by the render preset table now. This constant stays as
 * the single documented reference for what "the normal Coda picture" means and
 * as the fallback if a preset table is ever built without a model.
 */
export const CODA_DEFAULT_IMAGE_MODEL = CODA_IMAGE_MODEL;

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

/**
 * Decode the base64 payload the generator returned and read any generation
 * metadata it carries.
 *
 * Only PNG carries text chunks, so a WebP response yields nothing. That is
 * reported by omission rather than by inventing values: if the metadata is not
 * there, no metadata is claimed.
 */
function readGeneratedImageMetadata(base64: string) {
  try {
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    const inspection = inspectImage(bytes);
    if (!inspection?.png) return null;
    const generation = inspection.png.generation;
    return {
      format: inspection.format,
      width: inspection.width,
      height: inspection.height,
      source: inspection.png.source ?? null,
      software: inspection.png.software ?? null,
      generation: generation ?? null,
      // Repeated on the wire so a consumer cannot present this as observation.
      provenance: 'read from the file\'s embedded metadata, not from looking at the picture',
    };
  } catch {
    return null;
  }
}

function bridgeAuthorized(config: AppConfig, authorization: string | undefined) {
  if (!config.CODA_INTERNAL_BRIDGE_SECRET) return false;
  return authorization === `Bearer ${config.CODA_INTERNAL_BRIDGE_SECRET}`;
}

export function buildCodaImagePrompt(scene: string, variantIndex = randomInt(0, CODA_COMPOSITION_VARIANTS.length)) {
  const normalizedIndex = ((variantIndex % CODA_COMPOSITION_VARIANTS.length) + CODA_COMPOSITION_VARIANTS.length) % CODA_COMPOSITION_VARIANTS.length;
  const composition = CODA_COMPOSITION_VARIANTS[normalizedIndex];
  return `${CODA_VISUAL_IDENTITY} ${CODA_RENDERING_STYLE} Scene direction: ${scene}. Composition direction: ${composition} ${CODA_REPEAT_AVOIDANCE} Coda remains the sole character.`;
}

/** Structural negative prompt. Content-rating terms are added separately. */
export const CODA_NEGATIVE_PROMPT_BASE: string[] = [
  'multiple characters',
  'two characters',
  'crowd',
  'other character',
  'human',
  'realistic human',
  'human skin',
  'human face',
  'human ears',
  'human anatomy',
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
];

/**
 * The negative prompt actually sent.
 *
 * An SFW render must not be able to drift explicit even if the scene asks for
 * it or the model volunteers, so the SFW rating contributes an explicit-content
 * exclusion block. `human breasts`/`cleavage` were previously listed as bare
 * structural terms, which read as a shape preference rather than a rating
 * control; content-rating suppression belongs here, in one obvious place.
 */
export function buildCodaNegativePrompt(rating: CodaImageRating) {
  const base = [...CODA_NEGATIVE_PROMPT_BASE];
  if (rating === 'sfw') base.push(...codaSfwNegativeTerms());
  return base.join(', ');
}

type RenderDeps = {
  config: AppConfig;
  pool: DatabasePool;
  settingsStore?: SettingsStore;
  fetchImpl?: typeof fetch;
};

/**
 * Trusted adult-access evaluation for a bridge request.
 *
 * Settings win over the environment because the admin panel is the configured
 * source of truth for the guild and the accepted adult roles, and the
 * environment is only the fallback used before anything is saved.
 */
async function adultAccess(deps: RenderDeps, discordUserId: string) {
  const effective = deps.settingsStore
    ? await deps.settingsStore.getEffective()
    : undefined;
  return resolveCodaAdultAccess({
    config: deps.config,
    pool: deps.pool,
    discordUserId,
    guildId: effective?.guildId ?? deps.config.DISCORD_GUILD_ID,
    adultRoleIds: effective?.adultRoleIds ?? deps.config.envAdultRoleIds,
    fetchImpl: deps.fetchImpl,
  });
}

export interface CodaDiscordImageRouterDeps {
  /**
   * Injected for both the Discord role lookup and the NovelAI call. Production
   * leaves this unset and uses the global fetch; tests inject it so the gate can
   * be exercised without a live Discord call or a real Anlas spend.
   */
  fetchImpl?: typeof fetch;
}

export function createCodaDiscordImageRouter(
  config: AppConfig,
  pool: DatabasePool,
  settingsStore?: SettingsStore,
  deps: CodaDiscordImageRouterDeps = {},
) {
  const router = Router();
  const fetchImpl = deps.fetchImpl ?? fetch;

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

      const { discordUserId, scene, rating } = parsed.data;
      const quality = isCodaRenderQuality(parsed.data.quality) ? parsed.data.quality : 'standard';

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

      // Rating gate first, before any credential is opened. The decision comes
      // from the Discord role evaluation and the operator override, never from
      // the channel the request arrived in.
      if (rating === 'adult') {
        const access = await adultAccess({ config, pool, settingsStore, fetchImpl }, discordUserId);
        if (!access.canViewAdult) {
          console.warn('[coda-image] adult render refused', JSON.stringify({ discordUserId, source: access.source, reason: access.reason }));
          return response.status(403).json({
            code: 'coda_adult_access_required',
            error: '🐾 That render is 18+ and needs an adult role in Howling Whispers. I cannot draw it for your account, and I will not pretend otherwise.',
          });
        }
      } else if (sceneRequestsExplicitContent(scene)) {
        // Refusing here is honest: the member asked for explicit output without
        // declaring adult rating, so the answer is "declare it and pass the
        // role gate", not a quietly censored approximation.
        return response.status(422).json({
          code: 'coda_rating_required',
          error: '🐾 That scene asks for 18+ content. Ask for it as an adult render and it will be checked against the adult role in Howling Whispers.',
        });
      }

      const quote: CodaRenderQuote = quoteCodaRender(quality, rating);
      const preset = codaRenderPreset(quality);

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
      const negativePrompt = buildCodaNegativePrompt(rating);
      const seed = randomInt(0, 2_147_483_647);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180_000);

      try {
        const upstream = await fetchImpl('https://image.novelai.net/ai/generate-image', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            input: prompt,
            model: preset.model,
            action: 'generate',
            parameters: {
              params_version: 4,
              width: preset.width,
              height: preset.height,
              scale: preset.scale,
              sampler: 'k_euler_ancestral',
              steps: preset.steps,
              seed,
              n_samples: 1,
              noise_schedule: 'karras',
              dynamic_thresholding: false,
              deliberate_euler_ancestral_bug: false,
              prefer_brownian: true,
              qualityToggle: preset.qualityToggle,
              image_format: 'webp',
              uc: negativePrompt,
              negative_prompt: negativePrompt,
              v4_prompt: {
                caption: { base_caption: prompt, char_captions: [] },
                use_coords: false,
                use_order: true,
              },
              v4_negative_prompt: {
                caption: { base_caption: negativePrompt, char_captions: [] },
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

        const payload = await upstream.json().catch(() => undefined) as { images?: Array<{ image?: string; source?: string; seed?: number }> } | undefined;
        const first = payload?.images?.[0];
        if (!first?.image) {
          return response.status(502).json({ error: '🐾 NovelAI returned from the art room without an image. Rude.' });
        }

        // The generator's PNG source carries its own generation metadata. That
        // is what makes Coda able to say "this was drawn with 23 steps and this
        // seed" later, which is a claim about the file's bytes and never about
        // what the picture looks like.
        const metadata = readGeneratedImageMetadata(first.source || first.image);

        // The quote is echoed back so the member's confirmation receipt matches
        // exactly what was spent.
        console.info('[coda-image] render complete', JSON.stringify({
          discordUserId,
          quality,
          rating,
          estimatedAnlas: quote.estimatedAnlas,
          model: preset.model,
          steps: preset.steps,
          width: preset.width,
          height: preset.height,
        }));

        return response.json({
          ok: true,
          imageBase64: first.image,
          format: 'webp',
          model: preset.model,
          seed: first.seed ?? seed,
          scene,
          quote,
          ...(metadata ? { metadata } : {}),
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
