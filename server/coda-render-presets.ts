/**
 * Coda Render presets, model routing and Anlas cost estimation.
 *
 * Every field here is shown to the member before any Anlas is spent, so a
 * preset is not an internal tuning table. It is a menu with a price on it.
 *
 * On the cost estimate: this is an ESTIMATE, and it is labelled as one
 * everywhere it is rendered. The formula is deliberately simple and printed in
 * the confirmation card so a member can see roughly why a number was produced:
 *
 *   estimate = megapixels * steps * scale * 0.5, rounded up
 *
 * NovelAI's own Anlas accounting is not published as a stable formula and can
 * change, so the UI never claims an exact figure. What it does guarantee is
 * that the same request always produces the same quoted number, that a reroll
 * is quoted before it runs, and that nothing is generated without the member
 * having seen the quote.
 */

export type CodaRenderQuality = 'draft' | 'standard' | 'high' | 'max';
export type CodaImageRating = 'sfw' | 'adult';

export interface CodaRenderPreset {
  id: CodaRenderQuality;
  label: string;
  model: string;
  width: number;
  height: number;
  steps: number;
  scale: number;
  qualityToggle: boolean;
  /** Plain-language description shown in the confirmation card. */
  description: string;
}

const V5_FULL = 'nai-diffusion-5-full';

/**
 * V5 Full is the only diffusion model this deployment has verified working
 * with the requester's own NovelAI credential, so every preset routes to it.
 * The route is still explicit per preset rather than a single global constant:
 * the table is where a curated route would be added once one is verified, and
 * it keeps model choice visible in the confirmation card instead of implicit.
 */
export const CODA_RENDER_PRESETS: Record<CodaRenderQuality, CodaRenderPreset> = {
  draft: {
    id: 'draft',
    label: 'Draft',
    model: V5_FULL,
    width: 832,
    height: 1216,
    steps: 12,
    scale: 4,
    qualityToggle: false,
    description: 'Quick look. Fewer steps and no quality pass.',
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    model: V5_FULL,
    width: 832,
    height: 1216,
    steps: 23,
    scale: 5,
    qualityToggle: true,
    description: 'The normal Coda picture.',
  },
  high: {
    id: 'high',
    label: 'High',
    model: V5_FULL,
    width: 1216,
    height: 1824,
    steps: 28,
    scale: 7,
    qualityToggle: true,
    description: 'Larger frame, more steps and a stronger guidance scale.',
  },
  max: {
    id: 'max',
    label: 'Max',
    model: V5_FULL,
    width: 1216,
    height: 1824,
    steps: 36,
    scale: 9,
    qualityToggle: true,
    description: 'Most expensive option. Best detail, slowest, highest Anlas.',
  },
};

export const CODA_RENDER_QUALITIES: CodaRenderQuality[] = ['draft', 'standard', 'high', 'max'];

export function isCodaRenderQuality(value: unknown): value is CodaRenderQuality {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CODA_RENDER_PRESETS, value);
}

export function codaRenderPreset(quality: CodaRenderQuality): CodaRenderPreset {
  return CODA_RENDER_PRESETS[quality];
}

const MEGAPIXEL_COST_FACTOR = 0.5;

export interface CodaRenderQuote {
  quality: CodaRenderQuality;
  label: string;
  model: string;
  width: number;
  height: number;
  steps: number;
  scale: number;
  megapixels: number;
  estimatedAnlas: number;
  /** The arithmetic behind the estimate, so the number is not magic. */
  formula: string;
  rating: CodaImageRating;
  description: string;
}

/**
 * Deterministic estimate. `n_samples` is always 1 for Coda, so a reroll of the
 * same preset is always the same price and is quoted again before it runs.
 */
export function quoteCodaRender(
  quality: CodaRenderQuality,
  rating: CodaImageRating = 'sfw',
  overrides: Partial<Pick<CodaRenderPreset, 'width' | 'height' | 'steps' | 'scale'>> = {},
): CodaRenderQuote {
  const preset = { ...codaRenderPreset(quality), ...overrides };
  const megapixels = (preset.width * preset.height) / 1_000_000;
  const raw = megapixels * preset.steps * preset.scale * MEGAPIXEL_COST_FACTOR;
  const estimatedAnlas = Math.max(1, Math.ceil(raw));
  return {
    quality: preset.id,
    label: preset.label,
    model: preset.model,
    width: preset.width,
    height: preset.height,
    steps: preset.steps,
    scale: preset.scale,
    megapixels: Number(megapixels.toFixed(2)),
    estimatedAnlas,
    formula: `~${megapixels.toFixed(2)} MP x ${preset.steps} steps x ${preset.scale} scale x 0.5`,
    rating,
    description: preset.description,
  };
}

const SFW_NEGATIVE_PROMPT_TERMS = [
  'nsfw',
  'nude',
  'nudity',
  'naked',
  'topless',
  'bottomless',
  'undressed',
  'unclothed',
  'explicit',
  'pornographic',
  'sexually explicit',
  'erotic pose',
  'genitals',
  'visible nipple',
  'nipples',
  'areola',
  'cleavage emphasis',
  'see-through clothing',
  'transparent clothing',
  'lingerie only',
  'panties only',
  'sex act',
  'intercourse',
];

/**
 * Explicit-content suppression used for every SFW render.
 *
 * This is the real gate for the default rating: a member without adult access
 * can still use `/coda render`, and the request is pushed away from explicit
 * output by prompt-level exclusion rather than by hoping the scene is tame.
 */
export function codaSfwNegativeTerms(): string[] {
  return [...SFW_NEGATIVE_PROMPT_TERMS];
}

/**
 * A scene screen, not a guarantee.
 *
 * If someone asks for an explicit picture without declaring adult rating, the
 * honest move is to say so and point at the gated path, rather than quietly
 * rendering a censored guess. The screen is deliberately coarse: it catches
 * direct requests and lets ambiguous-but-tame scenes through to the normal SFW
 * prompt path.
 */
const explicitScenePattern = new RegExp([
  '\\bnsfw\\b',
  '\\bnude\\b', '\\bnudity\\b', '\\bnaked\\b', '\\btopless\\b', '\\bbottomless\\b',
  '\\bundressed\\b', '\\bunclothed\\b',
  // "explicit" on its own is too broad: an explicit raincoat or an explicit
  // rating label is not a request for explicit content. Only the phrases where
  // it actually modifies the picture are treated as a request.
  '\\bsexually explicit\\b', '\\bexplicit (?:content|scene|image|picture|render|artwork|nudity|sex)\\b',
  '\\bporn(?:o|ographic)?\\b',
  '\\berotic\\b', '\\bsexual(?:ly)?\\b', '\\bgenitals\\b',
  '\\b(?:visible |showing )?nipples?\\b', '\\bareolae?\\b',
  '\\bsex act\\b', '\\bintercourse\\b', '\\bhave sex\\b', '\\bmasturbat\\w*\\b',
  '\\borgasm\\b', '\\bfetish scene\\b',
].join('|'), 'i');

export function sceneRequestsExplicitContent(scene: string) {
  return explicitScenePattern.test(scene);
}