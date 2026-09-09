import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { ensureSuperAdminAccess, refreshSessionAccess } from './auth.js';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import { credentialKey, openCredential } from './provider-settings.js';
import type { SettingsStore } from './settings.js';

const launchableTypes = ['world', 'character', 'place', 'item', 'faction', 'species', 'society', 'family', 'memory'] as const;
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
  reroll: z.boolean().default(false),
});

const hashGrant = (grant: string) => createHash('sha256').update(grant).digest('hex');
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stringValue = (value: unknown) => typeof value === 'string' ? value : '';
const simulationType = (type: string) => type === 'species' || type === 'society' || type === 'family' || type === 'memory' ? 'other' : type;

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

function extractNovelAiText(value: unknown) {
  const choices = asRecord(value).choices;
  if (!Array.isArray(choices)) return '';
  const first = asRecord(choices[0]);
  if (typeof first.text === 'string') return first.text.trim();
  const message = asRecord(first.message);
  return typeof message.content === 'string' ? message.content.trim() : '';
}

function providerError(status: number) {
  if (status === 401) return 'NovelAI rejected the saved access token. Update it in Orbis settings.';
  if (status === 402 || status === 403) return 'NovelAI did not authorize this generation.';
  if (status === 404) return 'The selected NovelAI model is unavailable.';
  if (status === 429) return 'NovelAI is receiving too many requests. Wait and try again.';
  if (status >= 500) return 'NovelAI is temporarily unavailable.';
  return 'NovelAI could not generate this reply.';
}

async function requireLaunchUser(request: Request, config: AppConfig, pool: DatabasePool, settingsStore: SettingsStore) {
  if (!request.session.userId) return false;
  const isSuperAdmin = await ensureSuperAdminAccess(request, pool);
  if (!isSuperAdmin) await refreshSessionAccess(request, config, settingsStore);
  return true;
}

export function createSpeculusLaunchRouter(config: AppConfig, pool: DatabasePool, settingsStore: SettingsStore) {
  const router = Router();

  router.post('/assets/:id/simulate', async (request, response, next) => {
    try {
      if (!await requireLaunchUser(request, config, pool, settingsStore)) return response.status(401).json({ error: 'Sign in with Discord to simulate a record.' });
      if (!config.SPECULUS_BRIDGE_SECRET) return response.status(503).json({ error: 'The Speculus bridge is not configured.' });

      const assetResult = await pool.query(
        `SELECT * FROM library_assets WHERE id = $1 AND type = ANY($2::text[])`,
        [request.params.id, launchableTypes],
      );
      if (!assetResult.rowCount) return response.status(404).json({ error: 'Record not found.' });
      const asset = assetResult.rows[0];
      const ownsAsset = asset.creator_user_id === request.session.userId;
      if (asset.content_rating === 'adult' && !request.session.access?.canViewAdult && !ownsAsset) {
        return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
      }

      const [providerResult, userResult, relatedResult] = await Promise.all([
        pool.query(`SELECT model FROM user_provider_settings WHERE user_id = $1 AND provider = 'novelai'`, [request.session.userId]),
        pool.query('SELECT id, display_name FROM users WHERE id = $1', [request.session.userId]),
        pool.query(
          `SELECT * FROM library_assets
           WHERE id <> $1
             AND ($2::uuid IS NOT NULL AND (id = $2 OR origin_world_id = $2) OR $3::boolean AND origin_world_id = $1)
             AND (content_rating = 'sfw' OR $4::boolean OR creator_user_id = $5)
           ORDER BY CASE WHEN id = $2 THEN 0 ELSE 1 END, updated_at DESC
           LIMIT 20`,
          [asset.id, asset.origin_world_id ?? null, asset.type === 'world', request.session.access?.canViewAdult === true, request.session.userId],
        ),
      ]);
      if (!providerResult.rowCount) return response.status(409).json({ error: 'Add your NovelAI token in Orbis Account settings before starting Speculus.', settingsPath: '/account' });
      if (!userResult.rowCount) return response.status(401).json({ error: 'Your Orbis account could not be loaded.' });

      const now = Date.now();
      const expiresAt = now + config.SPECULUS_LAUNCH_TTL_SECONDS * 1000;
      const launchId = randomUUID();
      const grant = randomBytes(32).toString('base64url');
      const primaryAsset = simulationAsset(asset);
      const relatedAssets = relatedResult.rows.map((row) => simulationAsset(row, false));
      const card = characterCard(asset);
      const catalog = await catalogueIdentity(pool, asset);
      const packageBody = {
        version: 1,
        launchId,
        issuedAt: now,
        expiresAt,
        catalog,
        primaryAsset,
        relatedAssets,
        character: card,
        persona: {
          kind: 'persona',
          id: `orbis-user:${userResult.rows[0].id}`,
          name: userResult.rows[0].display_name,
          description: 'The active Orbis user. The simulator must not invent this person\'s actions, thoughts, or dialogue.',
        },
        scene: card?.scenario || String(asset.summary ?? ''),
        contextBlocks: relatedResult.rows.map((row) => ({
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
        const bridgeResponse = await fetch(`${config.SPECULUS_BRIDGE_URL.replace(/\/$/, '')}/api/launch`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.SPECULUS_BRIDGE_SECRET}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(packageBody),
          signal: controller.signal,
        });
        const bridgeBody = await bridgeResponse.json().catch(() => ({})) as { launchUrl?: string; error?: string };
        if (!bridgeResponse.ok || !bridgeBody.launchUrl) throw new Error(bridgeBody.error || `Speculus returned HTTP ${bridgeResponse.status}.`);
        response.status(201).json({ launchUrl: bridgeBody.launchUrl, expiresAt });
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
    try {
      const authorization = request.get('authorization') ?? '';
      const grant = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
      if (grant.length < 16) return response.status(401).json({ error: 'A valid Speculus generation grant is required.' });
      const body = generationSchema.parse(request.body);
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
      try {
        const upstream = await fetch('https://text.novelai.net/oa/v1/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: body.model,
            prompt: body.prompt,
            max_tokens: body.maxTokens,
            temperature: body.temperature,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            stream: false,
            stop: ['\n<|user|>', '\n<|assistant|>', '\nSystem:', '\nAnalysis:', '\nThinking:', '\n/nothink'],
            ...(body.reroll ? { seed: randomInt(1, 2_147_483_647) } : {}),
          }),
          signal: controller.signal,
        });
        if (!upstream.ok) return response.status(502).json({ error: providerError(upstream.status) });
        const payload: unknown = await upstream.json();
        const text = extractNovelAiText(payload);
        if (!text) return response.status(502).json({ error: 'NovelAI returned an empty roleplay reply.' });
        await pool.query('UPDATE generation_grants SET use_count = use_count + 1, last_used_at = now() WHERE token_hash = $1', [hashGrant(grant)]);
        const requestId = upstream.headers.get('x-request-id') ?? randomUUID();
        response.setHeader('x-request-id', requestId).json({ text });
      } finally { clearTimeout(timeout); }
    } catch (error) { next(error); }
  });

  return router;
}
