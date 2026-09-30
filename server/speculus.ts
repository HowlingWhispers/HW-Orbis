import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { ensureSuperAdminAccess, refreshSessionAccess, SUPER_ADMIN_DISCORD_ID } from './auth.js';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import { credentialKey, openCredential } from './provider-settings.js';
import type { SettingsStore } from './settings.js';
import { canDirectViewAssetRow, canUsePersonaAssetRow, isAdultRestrictedAssetRow } from './world-access.js';
import { generationErrors, providerErrorCode, rejectedParameter, safeFinishReason, type GenerationErrorCode } from './generation-errors.js';
import { bitterrootDirectTravelFromHollowmere } from './bitterroot-travel-canon.js';

const launchableTypes = ['world', 'character', 'place', 'item', 'faction', 'species', 'society', 'family', 'memory'] as const;
const simulationTones = ['world-default', 'family-friendly', 'mature', 'adult-erotic'] as const;
type SimulationTone = typeof simulationTones[number];
const launchSchema = z.object({
  personaId: z.string().uuid(),
  // Optional only for compatibility with older Orbis clients. The current UI
  // always supplies an explicit canonical Place anchor.
  startingPlaceId: z.string().uuid().optional(),
  resumeSaveId: z.string().uuid().optional(),
  tone: z.enum(simulationTones).default('world-default'),
  focusTags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  direction: z.string().trim().max(4000).default(''),
}).strict();
const resumeSaveSchema = z.object({
  format: z.literal('speculus-v2-session'),
  version: z.literal(2),
  engine: z.literal('v2'),
  source: z.object({
    id: z.string().uuid(),
    type: z.string().min(1).max(40),
    revision: z.string().min(1).max(200),
    persona: z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200) }).optional(),
    location: z.object({ id: z.string().uuid(), revision: z.string().min(1).max(200), name: z.string().min(1).max(200) }).nullable().optional(),
  }).passthrough(),
  turns: z.array(z.unknown()).max(20000),
}).passthrough();
const modelNames = ['xialong-v1', 'glm-4-6'] as const;
const generationSchema = z.object({
  launchId: z.string().uuid(),
  source: z.object({
    id: z.string().uuid(),
    revision: z.string().min(1).max(200),
    type: z.enum(['character', 'world', 'place', 'item', 'faction', 'other']),
  }),
  prompt: z.string().min(1).max(500_000),
  model: z.enum(modelNames),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(32).max(4096),
  topK: z.number().int().min(0).max(1000).default(250),
  topP: z.number().min(0).max(1).default(0.95),
  presencePenalty: z.number().min(-2).max(2).default(0),
  frequencyPenalty: z.number().min(-2).max(2).default(0),
  stopSequences: z.array(z.string().min(1).max(200)).max(16).default([]),
  continueToEndOfSentence: z.boolean().default(true),
  reroll: z.boolean().default(false),
});

const bridgeStopSequences = ['\n<|user|>', '\n<|assistant|>', '\nSystem:', '\nAnalysis:', '\nThinking:', '\n/nothink'];
const sentenceControl = '<generation_control>Complete the final sentence within the output allowance. Do not begin another sentence unless it can also be completed.</generation_control>';

const hashGrant = (grant: string) => createHash('sha256').update(grant).digest('hex');
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stringValue = (value: unknown) => typeof value === 'string' ? value : '';
const simulationType = (type: string) => type === 'species' || type === 'society' || type === 'family' || type === 'memory' ? 'other' : type;
const isStructuredSpeculusPrompt = (prompt: string) => prompt.startsWith('SPECULUS V2 /') || prompt.startsWith('SPECULUS V3 EXPERIMENTAL /');
const isV2OrV3StructuredPrompt = (prompt: string) => prompt.startsWith('SPECULUS V2 /') || prompt.startsWith('SPECULUS V3 EXPERIMENTAL /');

function withSentenceControl(prompt: string) {
  if (!isV2OrV3StructuredPrompt(prompt)) return `${prompt}\n${sentenceControl}`;
  const v2ResponseMarker = '\n[IN-WORLD RESPONSE]\n';
  if (prompt.endsWith(v2ResponseMarker)) {
    return `${prompt.slice(0, -v2ResponseMarker.length)}\n${sentenceControl}${v2ResponseMarker}`;
  }
  return `${prompt}\n${sentenceControl}`;
}

async function catalogueIdentity(pool: DatabasePool, row: Record<string, unknown>) {
  const result = await pool.query(
    `SELECT code, prefix, plate, generation, registry_number, class_registry_number,
            classification, asset_created_at, status
     FROM ensure_speculus_catalog_entry_v2($1::uuid, $2::text, $3::jsonb, $4::timestamptz)`,
    [String(row.id), String(row.type), JSON.stringify(row.document ?? {}), row.created_at],
  );
  if (!result.rowCount) throw new Error('Orbis could not assign a Speculus catalogue designation.');
  const catalog = result.rows[0];
  return {
    code: String(catalog.code),
    prefix: String(catalog.prefix),
    plate: String(catalog.plate),
    generation: Number(catalog.generation),
    registryNumber: Number(catalog.registry_number),
    classRegistryNumber: Number(catalog.class_registry_number),
    classification: String(catalog.classification),
    createdAt: new Date(String(catalog.asset_created_at)).toISOString(),
    status: String(catalog.status),
  };
}

function simulationAsset(row: Record<string, unknown>, includeData = true) {
  return {
    id: String(row.id),
    revision: new Date(String(row.updated_at)).toISOString(),
    type: simulationType(String(row.type)),
    name: String(row.name),
    summary: String(row.summary ?? ''),
    data: includeData ? row.document ?? {} : {},
  };
}

function sourceIdentityForRow(row: Record<string, unknown>) {
  const document = asRecord(row.document);
  const explicit = stringValue(document.sourceId);
  if (explicit) return explicit;
  const sourceAssetId = stringValue(row.source_asset_id);
  const prefix = `${stringValue(row.type)}:`;
  if (sourceAssetId.startsWith(prefix) && sourceAssetId.length > prefix.length) return sourceAssetId.slice(prefix.length);
  return stringValue(document.id);
}
function familyReferencedCharacterRows(family: Record<string, unknown>, rows: Record<string, unknown>[]) {
  const familyText = JSON.stringify(family.document ?? {}).toLowerCase();
  return rows.filter((row) => {
    if (row.type !== 'character') return false;
    const id = String(row.id).toLowerCase();
    const sourceId = sourceIdentityForRow(row).toLowerCase();
    const name = String(row.name).trim().toLowerCase();
    return (id && familyText.includes(id))
      || (sourceId && familyText.includes(sourceId))
      || (name && familyText.includes(name));
  });
}

export function simulationNavigationData(row: Record<string, unknown>, bitterroot = false) {
  if (row.type !== 'place') return {};
  const document = asRecord(row.document);
  const sourceId = sourceIdentityForRow(row);
  const kind = stringValue(document.kind);
  const parentLocationId = stringValue(document.parentLocationId);
  const storedTravel = asRecord(document.travelFromHollowmere);
  const fallbackTravel = bitterroot && sourceId ? bitterrootDirectTravelFromHollowmere(sourceId) : null;
  const travelFromHollowmere = Object.keys(storedTravel).length ? storedTravel : fallbackTravel;
  return {
    ...(sourceId ? { sourceId } : {}),
    ...(kind ? { kind } : {}),
    ...(parentLocationId ? { parentLocationId } : {}),
    ...(travelFromHollowmere ? { travelFromHollowmere } : {}),
  };
}

function simulationWorldId(row: Record<string, unknown>) {
  if (row.type === 'world') return String(row.id);
  return row.origin_world_id ? String(row.origin_world_id) : undefined;
}

export function isStartingPlaceInSimulationScope(primary: Record<string, unknown>, place: Record<string, unknown>) {
  if (place.type !== 'place') return false;
  if (primary.type === 'place' && String(primary.id) === String(place.id)) return true;
  const worldId = simulationWorldId(primary);
  return Boolean(worldId && place.origin_world_id && String(place.origin_world_id) === worldId);
}

function simulationPlaceOption(row: Record<string, unknown>, targetId: string) {
  const document = asRecord(row.document);
  const kind = stringValue(document.kind);
  const parentLocationId = stringValue(document.parentLocationId);
  return {
    id: String(row.id),
    name: String(row.name),
    summary: String(row.summary ?? ''),
    ...(kind ? { kind } : {}),
    ...(parentLocationId ? { parentLocationId } : {}),
    isTarget: String(row.id) === targetId,
  };
}

export function resolveInitialLocationId(primary: Record<string, unknown>, related: Record<string, unknown>[]) {
  if (primary.type === 'place') return String(primary.id);
  const records = [primary, ...related];
  const isBitterroot = records.some((row) => row.type === 'world' && String(row.name).trim().toLowerCase() === 'bitterroot');
  if (!isBitterroot) return undefined;
  const hollowmere = records.find((row) => row.type === 'place' && sourceIdentityForRow(row) === 'hollowmere');
  return hollowmere ? String(hollowmere.id) : undefined;
}

function characterCard(row: Record<string, unknown>) {
  if (row.type !== 'character') return null;
  const document = asRecord(row.document);
  return {
    kind: 'character',
    id: String(row.id),
    spec: 'chara_card_v2',
    name: String(row.name),
    description: stringValue(document.description) || String(row.summary ?? ''),
    personality: stringValue(document.personality),
    scenario: stringValue(document.scenario),
    firstMessage: stringValue(document.firstMessage) || stringValue(document.first_mes),
    exampleDialogue: stringValue(document.exampleDialogue) || stringValue(document.mes_example),
    systemPrompt: stringValue(document.systemPrompt) || stringValue(document.system_prompt),
    postHistoryInstructions: stringValue(document.postHistoryInstructions) || stringValue(document.post_history_instructions),
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  };
}

export function simulationPersonaAge(row: Record<string, unknown>) {
  const identity = asRecord(asRecord(row.document).identity);
  const rawAge = identity.age;
  if (typeof rawAge === 'number' && Number.isFinite(rawAge) && rawAge >= 0) return rawAge;
  if (typeof rawAge !== 'string') return undefined;
  const match = rawAge.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const age = Number(match[1]);
  return Number.isFinite(age) && age >= 0 ? age : undefined;
}

export function simulationPersonaAdultToneEligible(row: Record<string, unknown>, canViewAdult: boolean) {
  const age = simulationPersonaAge(row);
  return canViewAdult && age !== undefined && age >= 18;
}

export function buildSimulationLaunchDirection(input: { tone: SimulationTone; focusTags: string[]; direction: string }) {
  const toneInstructions: Record<SimulationTone, string> = {
    'world-default': 'Follow the authored world and character canon without adding a special content filter.',
    'family-friendly': 'Keep foregrounded content suitable for general audiences. Avoid sexual content, graphic violence, and explicit adult material.',
    mature: 'Serious adult themes, stronger language, and non-sexual violence may be foregrounded when appropriate. Do not generate explicit sexual content.',
    'adult-erotic': 'Adult erotic and intimate content may be foregrounded when requested, but sexual content may involve adults only. Never sexualize minors or place minors inside sexual activity.',
  };
  const toneLabels: Record<SimulationTone, string> = {
    'world-default': 'World default',
    'family-friendly': 'Family-friendly',
    mature: 'Mature',
    'adult-erotic': 'Adult / erotic (18+)',
  };
  if (input.tone === 'world-default' && input.focusTags.length === 0 && !input.direction.trim()) return '';
  return [
    'SESSION DIRECTION / LAUNCH-ONLY / NOT CANON',
    'This is temporary steering for this simulation session. It may shape tone, pacing, emphasis, and what kinds of events are foregrounded, but it does not rewrite Orbis canon, physical state, character knowledge, relationships, or permissions.',
    `Content tone: ${toneLabels[input.tone]}.`,
    toneInstructions[input.tone],
    input.focusTags.length ? `Focus tags: ${input.focusTags.join(', ')}.` : '',
    input.direction.trim() ? `User direction:\n${input.direction.trim()}` : '',
  ].filter(Boolean).join('\n');
}

const personaCoreKeys = ['appearance', 'personality', 'background', 'speech', 'preferences', 'skills', 'notes'] as const;
const personaIdentityKeys = ['displayName', 'species', 'age', 'pronouns', 'description'] as const;

export function simulationPersona(row: Record<string, unknown>) {
  const document = asRecord(row.document);
  const coreDocument: Record<string, unknown> = {};
  const sourceIdentity = asRecord(document.identity);
  const identity = Object.fromEntries(personaIdentityKeys
    .filter((key) => sourceIdentity[key] !== undefined)
    .map((key) => [key, sourceIdentity[key]]));
  if (Object.keys(identity).length) coreDocument.identity = identity;
  for (const key of personaCoreKeys) {
    if (document[key] !== undefined) coreDocument[key] = document[key];
  }
  return {
    kind: 'persona' as const,
    id: String(row.id),
    name: String(row.name),
    document: coreDocument,
    description: Object.keys(coreDocument).length
      ? JSON.stringify(coreDocument, null, 2)
      : String(row.summary ?? ''),
  };
}

function extractNovelAiText(value: unknown) {
  const choices = asRecord(value).choices;
  if (!Array.isArray(choices)) return '';
  const first = asRecord(choices[0]);
  const text = typeof first.text === 'string' ? first.text.trim() : '';
  if (text) return text;
  const parsedContent = first.parsedContent ?? first.parsed_content;
  if (typeof parsedContent === 'string' && parsedContent.trim()) return parsedContent.trim();
  const message = asRecord(first.message);
  return typeof message.content === 'string' ? message.content.trim() : '';
}

function extractNovelAiFinishReason(value: unknown): string | undefined {
  const choices = asRecord(value).choices;
  if (!Array.isArray(choices)) return undefined;
  const reason = asRecord(choices[0]).finish_reason;
  return typeof reason === 'string' ? reason : undefined;
}

async function requireLaunchUser(request: Request, config: AppConfig, pool: DatabasePool, settingsStore: SettingsStore) {
  if (!request.session.userId) return false;
  const isSuperAdmin = await ensureSuperAdminAccess(request, pool);
  if (!isSuperAdmin) await refreshSessionAccess(request, config, settingsStore, pool);
  return true;
}

export function createSpeculusLaunchRouter(config: AppConfig, pool: DatabasePool, settingsStore: SettingsStore) {
  const router = Router();

  router.get('/simulation-personas', async (request, response, next) => {
    try {
      if (!await requireLaunchUser(request, config, pool, settingsStore)) return response.status(401).json({ error: 'Sign in with Discord to choose a Persona.' });
      const result = await pool.query(
        `SELECT id, type, name, summary, creator_user_id, content_rating, document
         FROM library_assets
         WHERE type = 'persona'
         ORDER BY name ASC`,
      );
      const canViewAdult = request.session.access?.canViewAdult === true;
      const items = result.rows
        .filter((row) => canUsePersonaAssetRow(row, request.session.userId))
        .filter((row) => !isAdultRestrictedAssetRow(row, request.session.userId, canViewAdult))
        .map((row) => {
          const age = simulationPersonaAge(row);
          return {
            id: String(row.id),
            name: String(row.name),
            summary: String(row.summary ?? ''),
            owned: row.creator_user_id === request.session.userId,
            ...(age !== undefined ? { age } : {}),
            adultToneEligible: simulationPersonaAdultToneEligible(row, canViewAdult),
          };
        });
      response.json({ items });
    } catch (error) { next(error); }
  });

  router.get('/assets/:id/simulation-places', async (request, response, next) => {
    try {
      if (!await requireLaunchUser(request, config, pool, settingsStore)) return response.status(401).json({ error: 'Sign in with Discord to choose a starting Place.' });
      const assetResult = await pool.query(
        `SELECT a.*, origin.document AS origin_world_document,
                origin.creator_user_id AS origin_world_creator_user_id
         FROM library_assets a
         LEFT JOIN library_assets origin ON origin.id = a.origin_world_id
         WHERE a.id = $1 AND a.type = ANY($2::text[])`,
        [request.params.id, launchableTypes],
      );
      if (!assetResult.rowCount) return response.status(404).json({ error: 'Record not found.' });
      const asset = assetResult.rows[0];
      const isSuperAdmin = request.session.discordUserId === SUPER_ADMIN_DISCORD_ID;
      if (!canDirectViewAssetRow(asset, request.session.userId, isSuperAdmin)) return response.status(404).json({ error: 'Record not found.' });
      const ownsAsset = asset.creator_user_id === request.session.userId;
      if (asset.content_rating === 'adult' && !request.session.access?.canViewAdult && !ownsAsset) {
        return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
      }

      const worldId = simulationWorldId(asset);
      let rows: Record<string, unknown>[] = [];
      if (worldId) {
        const placesResult = await pool.query(
          `SELECT place.*, origin.document AS origin_world_document,
                  origin.creator_user_id AS origin_world_creator_user_id
           FROM library_assets place
           LEFT JOIN library_assets origin ON origin.id = place.origin_world_id
           WHERE place.type = 'place' AND place.origin_world_id = $1
           ORDER BY CASE WHEN place.id = $2 THEN 0 ELSE 1 END, place.name ASC`,
          [worldId, asset.id],
        );
        rows = placesResult.rows;
      } else if (asset.type === 'place') {
        rows = [asset];
      }

      const items = rows
        .filter((row) => canDirectViewAssetRow(row, request.session.userId, isSuperAdmin))
        .filter((row) => !isAdultRestrictedAssetRow(row, request.session.userId, request.session.access?.canViewAdult === true))
        .map((row) => simulationPlaceOption(row, String(asset.id)));
      response.json({ items });
    } catch (error) { next(error); }
  });

  router.post('/assets/:id/simulate', async (request, response, next) => {
    try {
      if (!await requireLaunchUser(request, config, pool, settingsStore)) return response.status(401).json({ error: 'Sign in with Discord to simulate a record.' });
      if (!config.SPECULUS_BRIDGE_SECRET) return response.status(503).json({ error: 'The Speculus bridge is not configured.' });
      const parsedBody = launchSchema.safeParse(request.body);
      if (!parsedBody.success) return response.status(400).json({ error: 'Simulation setup is invalid.' });

      const assetResult = await pool.query(
        `SELECT a.*, origin.document AS origin_world_document,
                origin.creator_user_id AS origin_world_creator_user_id
         FROM library_assets a
         LEFT JOIN library_assets origin ON origin.id = a.origin_world_id
         WHERE a.id = $1 AND a.type = ANY($2::text[])`,
        [request.params.id, launchableTypes],
      );
      if (!assetResult.rowCount) return response.status(404).json({ error: 'Record not found.' });
      const asset = assetResult.rows[0];
      const isSuperAdmin = request.session.discordUserId === SUPER_ADMIN_DISCORD_ID;
      if (!canDirectViewAssetRow(asset, request.session.userId, isSuperAdmin)) return response.status(404).json({ error: 'Record not found.' });
      const ownsAsset = asset.creator_user_id === request.session.userId;
      if (asset.content_rating === 'adult' && !request.session.access?.canViewAdult && !ownsAsset) {
        return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
      }

      let resumeSave: z.infer<typeof resumeSaveSchema> | undefined;
      if (parsedBody.data.resumeSaveId) {
        const resumeResult = await pool.query(
          'SELECT payload FROM speculus_saves WHERE id = $1 AND user_id = $2',
          [parsedBody.data.resumeSaveId, request.session.userId],
        );
        if (!resumeResult.rowCount) return response.status(404).json({ error: 'Archived save not found.' });
        const parsedResume = resumeSaveSchema.safeParse(resumeResult.rows[0].payload);
        if (!parsedResume.success) return response.status(409).json({ error: 'This archived save cannot be resumed by the current Speculus bridge.' });
        resumeSave = parsedResume.data;
        const currentRevision = new Date(String(asset.updated_at)).toISOString();
        if (resumeSave.source.id !== String(asset.id)
          || resumeSave.source.type !== simulationType(String(asset.type))
          || resumeSave.source.revision !== currentRevision) {
          return response.status(409).json({ error: 'This save belongs to a different or older revision. Review or export it instead of continuing it.' });
        }
        if (!resumeSave.source.persona?.id) {
          return response.status(409).json({ error: 'This older save does not identify an Orbis Persona, so one-click Continue is unavailable.' });
        }
        if (resumeSave.source.persona.id !== parsedBody.data.personaId) {
          return response.status(409).json({ error: 'The selected Persona does not match the Persona stored in this save.' });
        }
      }

      const personaResult = await pool.query(
        `SELECT id, type, name, summary, creator_user_id, content_rating, document
         FROM library_assets
         WHERE id = $1 AND type = 'persona'`,
        [parsedBody.data.personaId],
      );
      if (!personaResult.rowCount) return response.status(404).json({ error: 'Persona not found.' });
      const persona = personaResult.rows[0];
      const hasOrdinaryPersonaAccess = canDirectViewAssetRow(persona, request.session.userId, false);
      const mayUsePersona = canUsePersonaAssetRow(persona, request.session.userId);
      if (!hasOrdinaryPersonaAccess && !isSuperAdmin) return response.status(404).json({ error: 'Persona not found.' });
      if (!mayUsePersona && !isSuperAdmin) return response.status(403).json({ error: 'This Persona is not shared for use.' });
      if (isAdultRestrictedAssetRow(persona, request.session.userId, request.session.access?.canViewAdult === true)) {
        return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
      }
      if (parsedBody.data.tone === 'adult-erotic') {
        if (request.session.access?.canViewAdult !== true) {
          return response.status(403).json({ error: '18+ verification is required for Adult / erotic simulation tone.', verificationPath: '/verification' });
        }
        if (!simulationPersonaAdultToneEligible(persona, true)) {
          return response.status(400).json({ error: 'Adult / erotic simulation tone requires a Persona whose age is explicitly 18 or older.' });
        }
      }

      let startingPlace: Record<string, unknown> | undefined;
      const requestedStartingPlaceId = parsedBody.data.startingPlaceId ?? resumeSave?.source.location?.id;
      if (requestedStartingPlaceId) {
        const startingPlaceResult = await pool.query(
          `SELECT place.*, origin.document AS origin_world_document,
                  origin.creator_user_id AS origin_world_creator_user_id
           FROM library_assets place
           LEFT JOIN library_assets origin ON origin.id = place.origin_world_id
           WHERE place.id = $1 AND place.type = 'place'`,
          [requestedStartingPlaceId],
        );
        if (!startingPlaceResult.rowCount) return response.status(404).json({ error: 'Starting Place not found.' });
        const candidate = startingPlaceResult.rows[0];
        if (!canDirectViewAssetRow(candidate, request.session.userId, isSuperAdmin)) return response.status(404).json({ error: 'Starting Place not found.' });
        if (isAdultRestrictedAssetRow(candidate, request.session.userId, request.session.access?.canViewAdult === true)) {
          return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
        }
        if (!isStartingPlaceInSimulationScope(asset, candidate)) {
          return response.status(400).json({ error: 'Choose a starting Place from the same world as the record you are simulating.' });
        }
        startingPlace = candidate;
      }

      const [providerResult, relatedResult] = await Promise.all([
        pool.query(`SELECT model FROM user_provider_settings WHERE user_id = $1 AND provider = 'novelai'`, [request.session.userId]),
        pool.query(
          `SELECT * FROM library_assets
           WHERE id <> $1
             AND ($2::uuid IS NOT NULL AND (id = $2 OR origin_world_id = $2) OR $3::boolean AND origin_world_id = $1)
             AND (content_rating = 'sfw' OR $4::boolean OR creator_user_id = $5)
           ORDER BY CASE WHEN id = $2 THEN 0 ELSE 1 END, updated_at DESC
           LIMIT 200`,
          [asset.id, asset.origin_world_id ?? null, asset.type === 'world', request.session.access?.canViewAdult === true, request.session.userId],
        ),
      ]);
      if (!providerResult.rowCount) return response.status(409).json({ error: 'Add your NovelAI token in Orbis Account settings before starting Speculus.', settingsPath: '/account' });

      const now = Date.now();
      const expiresAt = now + config.SPECULUS_LAUNCH_TTL_SECONDS * 1000;
      const launchId = randomUUID();
      const grant = randomBytes(32).toString('base64url');
      const isBitterroot = [asset, ...relatedResult.rows].some((row) => row.type === 'world' && String(row.name).trim().toLowerCase() === 'bitterroot');
      const primaryAsset = asset.type === 'place'
        ? { ...simulationAsset(asset), data: { ...asRecord(asset.document), ...simulationNavigationData(asset, isBitterroot) } }
        : simulationAsset(asset);
      const baseScopedRelatedRows = asset.type === 'family'
        ? familyReferencedCharacterRows(asset, relatedResult.rows)
        : relatedResult.rows;
      const scopedRelatedRows = startingPlace && String(startingPlace.id) !== String(asset.id)
        ? [startingPlace, ...baseScopedRelatedRows.filter((row) => String(row.id) !== String(startingPlace.id))]
        : baseScopedRelatedRows;
      const relatedAssets = scopedRelatedRows.map((row) => {
        const packaged = simulationAsset(row, false);
        return row.type === 'place' ? { ...packaged, data: simulationNavigationData(row, isBitterroot) } : packaged;
      });
      const initialLocationId = startingPlace ? String(startingPlace.id) : resolveInitialLocationId(asset, scopedRelatedRows);
      const card = characterCard(asset);
      const catalog = await catalogueIdentity(pool, asset);
      const baseScene = card?.scenario || String(asset.summary ?? '');
      const launchDirection = buildSimulationLaunchDirection(parsedBody.data);
      const packageBody = {
        // V3 currently uses the isolated V2-compatible bridge contract.
        version: 2,
        engine: 'v2',
        launchId,
        issuedAt: now,
        expiresAt,
        ...(initialLocationId ? { initialLocationId } : {}),
        catalog,
        primaryAsset,
        relatedAssets,
        character: card,
        persona: simulationPersona(persona),
        scene: [baseScene, launchDirection].filter(Boolean).join('\n\n'),
        contextBlocks: scopedRelatedRows.slice(0, 20).map((row) => ({
          id: String(row.id),
          title: String(row.name),
          content: JSON.stringify(row.document ?? {}).slice(0, 60_000),
        })),
        relationshipState: asRecord(asRecord(asset.document).relationshipState),
        model: providerResult.rows[0].model,
        generationGrant: grant,
      };

      await pool.query(
        `INSERT INTO generation_grants (token_hash, launch_id, user_id, asset_id, asset_type, asset_revision, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))`,
        [hashGrant(grant), launchId, request.session.userId, asset.id, primaryAsset.type, primaryAsset.revision, expiresAt],
      );

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const bridgeResponse = await fetch(`${config.SPECULUS_BRIDGE_URL.replace(/\/$/, '')}/api/v2/launch`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.SPECULUS_BRIDGE_SECRET}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(resumeSave ? { package: packageBody, resumeSave } : packageBody),
          signal: controller.signal,
        });
        const bridgeBody = await bridgeResponse.json().catch(() => ({})) as { launchUrl?: string; error?: string };
        if (!bridgeResponse.ok || !bridgeBody.launchUrl) throw new Error(bridgeBody.error || `Speculus returned HTTP ${bridgeResponse.status}.`);
        const url = new URL(bridgeBody.launchUrl);
        if (url.pathname === '/v2') url.pathname = '/';
        else if (url.pathname.startsWith('/v2/')) url.pathname = `/${url.pathname.slice(4)}`;
        response.status(201).json({ launchUrl: url.toString(), expiresAt });
      } catch (error) {
        await pool.query('UPDATE generation_grants SET revoked_at = now() WHERE launch_id = $1', [launchId]);
        throw error;
      } finally { clearTimeout(timeout); }
    } catch (error) { next(error); }
  });

  return router;
}

export function createSpeculusGenerationRouter(config: AppConfig, pool: DatabasePool) {
  const router = Router();

  router.post('/speculus', async (request, response, next) => {
    const requestId = randomUUID();
    response.setHeader('x-request-id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    let debugRequestId = requestId;
    try {
      const authorization = request.get('authorization') ?? '';
      const grant = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (grant.length < 16) return response.status(401).json({ error: 'A valid Speculus generation grant is required.' });
      const body = generationSchema.parse(request.body);
      const structured = isStructuredSpeculusPrompt(body.prompt);
      if (structured && body.prompt.startsWith('SPECULUS V3 EXPERIMENTAL /')) {
        console.warn('Speculus V3 generation request', {
          requestId: debugRequestId,
          model: body.model,
          maxTokens: body.maxTokens,
          temperature: body.temperature,
          topK: body.topK,
          topP: body.topP,
          stopSequences: body.stopSequences,
          continueToEndOfSentence: body.continueToEndOfSentence,
          reroll: body.reroll,
          promptLength: body.prompt.length,
        });
      }
      const result = await pool.query(
        `SELECT g.launch_id, g.asset_id, g.asset_type, g.asset_revision, g.expires_at,
                p.model, p.token_ciphertext, p.token_iv, p.token_tag
         FROM generation_grants g
         JOIN user_provider_settings p ON p.user_id = g.user_id AND p.provider = 'novelai'
         WHERE g.token_hash = $1 AND g.revoked_at IS NULL AND g.expires_at > now()`,
        [hashGrant(grant)],
      );
      if (!result.rowCount) return response.status(401).json({ error: 'The Speculus generation grant is missing, expired, or revoked.' });
      const authorizationRow = result.rows[0];
      if (String(authorizationRow.launch_id) !== body.launchId
        || String(authorizationRow.asset_id) !== body.source.id
        || String(authorizationRow.asset_type) !== body.source.type
        || String(authorizationRow.asset_revision) !== body.source.revision
        || String(authorizationRow.model) !== body.model) {
        return response.status(403).json({ error: 'The generation request does not match its authorized launch package.' });
      }

      const token = openCredential({
        ciphertext: authorizationRow.token_ciphertext,
        iv: authorizationRow.token_iv,
        tag: authorizationRow.token_tag,
      }, credentialKey(config.ORBIS_CREDENTIAL_ENCRYPTION_KEY));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180_000);
      const fail = (code: GenerationErrorCode, details: { upstreamStatus?: number; parameter?: string; finishReason?: string } = {}) => {
        const diagnostic = { code, requestId, ...details, requestedMaxTokens: body.maxTokens };
        console.warn('Speculus generation failed', diagnostic);
        return response.status(code === 'NOVELAI_TIMEOUT' ? 504 : 502).json({ error: generationErrors[code], ...diagnostic });
      };
      try {
        let upstream: globalThis.Response;
        try {
          const finalStop = [...new Set([...(structured ? [] : bridgeStopSequences), ...body.stopSequences])];
          if (structured && body.prompt.startsWith('SPECULUS V3 EXPERIMENTAL /')) {
            console.warn('Speculus V3 final stop sequences', { requestId: debugRequestId, structured, finalStop, bridgeStopSequencesAdded: !structured, bodyStopSequences: body.stopSequences });
          }
          upstream = await fetch('https://text.novelai.net/oa/v1/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: body.model,
              prompt: body.continueToEndOfSentence ? withSentenceControl(body.prompt) : body.prompt,
              max_tokens: body.maxTokens,
              temperature: body.temperature,
              top_k: body.topK,
              top_p: body.topP,
              frequency_penalty: body.frequencyPenalty,
              presence_penalty: body.presencePenalty,
              stream: false,
              stop: finalStop,
              ...(body.reroll ? { seed: randomInt(1, 2_147_483_647) } : {}),
            }),
            signal: controller.signal,
          });
        } catch {
          return fail(controller.signal.aborted ? 'NOVELAI_TIMEOUT' : 'NOVELAI_NETWORK_FAILURE');
        }
        let payload: unknown;
        try { payload = await upstream.json(); }
        catch {
          if (controller.signal.aborted) return fail('NOVELAI_TIMEOUT');
          if (upstream.ok) return fail('NOVELAI_INVALID_RESPONSE', { upstreamStatus: upstream.status });
          // An HTML gateway error still has a useful HTTP status.
        }
        if (!upstream.ok) return fail(providerErrorCode(upstream.status), { upstreamStatus: upstream.status, parameter: rejectedParameter(payload) });
        const text = extractNovelAiText(payload);
        if (!text) return fail('NOVELAI_EMPTY_REPLY', { upstreamStatus: upstream.status, finishReason: safeFinishReason(extractNovelAiFinishReason(payload)) });
        await pool.query('UPDATE generation_grants SET use_count = use_count + 1, last_used_at = now() WHERE token_hash = $1', [hashGrant(grant)]);
        const requestId = upstream.headers.get('x-request-id') ?? randomUUID();
        response.setHeader('x-request-id', requestId).json({ text, finishReason: extractNovelAiFinishReason(payload) });
      } finally { clearTimeout(timeout); }
    } catch (error) { next(error); }
  });

  return router;
}
