import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { ensureSuperAdminAccess, refreshSessionAccess, requireCreator, SUPER_ADMIN_DISCORD_ID } from './auth.js';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import type { SettingsStore } from './settings.js';

const assetTypes = ['world', 'character', 'place', 'item', 'faction', 'species', 'society', 'family', 'memory'] as const;
const sourceTypes = ['curated', 'user-created', 'imported-v2', 'copied', 'public-curated', 'legacy-import'] as const;
const tones = ['moon', 'forest', 'ember', 'mist', 'violet', 'river'] as const;
const documentSchema = z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 128_000, 'Record content is too large.');

const createAssetSchema = z.object({
  type: z.enum(assetTypes),
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2000).default(''),
  originWorldId: z.string().uuid().nullable().optional(),
  contentRating: z.enum(['sfw', 'adult']).default('sfw'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  visualTone: z.enum(tones).default('moon'),
  document: documentSchema.default({}),
});
const updateAssetSchema = createAssetSchema.omit({ type: true }).partial().extend({ document: documentSchema.optional() });

function canViewAdult(request: Request) {
  return request.session.access?.canViewAdult === true;
}

function mapAsset(row: Record<string, unknown>, userId?: string, isSuperAdmin = false) {
  if (row.restricted) {
    return {
      id: `restricted:${row.id}`,
      type: row.type,
      name: 'Not verified',
      summary: 'This record is available to verified adult members of The Howling Whispers Discord.',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sourceType: 'user-created',
      contentRating: 'adult',
      tags: ['Verification required'],
      dependencyCount: 0,
      pinned: false,
      visualTone: 'mist',
      restricted: true,
      verificationPath: '/verification',
    };
  }
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    summary: row.summary,
    originWorldId: row.origin_world_id ?? undefined,
    originWorldName: row.origin_world_name ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceType: row.source_type,
    contentRating: row.content_rating,
    tags: row.tags,
    dependencyCount: row.dependency_count,
    pinned: row.pinned,
    visualTone: row.visual_tone,
    sourceAssetId: row.source_asset_id ?? undefined,
    document: row.document ?? {},
    speculus: row.speculus_code ? {
      code: String(row.speculus_code),
      classification: String(row.speculus_classification ?? ''),
    } : undefined,
    canEdit: isSuperAdmin || Boolean(userId && row.creator_user_id === userId),
    author: row.creator_user_id ? { id: row.creator_user_id, displayName: row.author_name, avatarUrl: row.author_avatar_url ?? undefined } : undefined,
  };
}

const selectAssets = `
  SELECT a.*, origin.name AS origin_world_name,
    u.display_name AS author_name, u.avatar_url AS author_avatar_url,
    sc.code AS speculus_code, sc.classification AS speculus_classification,
    (a.content_rating = 'adult' AND NOT $1::boolean AND a.creator_user_id IS DISTINCT FROM $2::uuid) AS restricted
  FROM library_assets a
  LEFT JOIN library_assets origin ON origin.id = a.origin_world_id
  LEFT JOIN users u ON u.id = a.creator_user_id
  LEFT JOIN speculus_catalog_registry sc ON sc.asset_id = a.id`;

function requestIdentity(request: Request) {
  return {
    userId: request.session.userId,
    isSuperAdmin: request.session.discordUserId === SUPER_ADMIN_DISCORD_ID,
  };
}

export function createLibraryRouter(config: AppConfig, pool: DatabasePool, settingsStore: SettingsStore) {
  const router = Router();

  router.use(async (request, _response, next) => {
    try {
      const isSuperAdmin = await ensureSuperAdminAccess(request, pool);
      if (!isSuperAdmin) await refreshSessionAccess(request, config, settingsStore);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/overview', async (request, response, next) => {
    try {
      const adult = canViewAdult(request);
      const identity = requestIdentity(request);
      const [recent, pinned, counts] = await Promise.all([
        pool.query(`${selectAssets} ORDER BY a.updated_at DESC LIMIT 4`, [adult, identity.userId ?? null]),
        pool.query(`${selectAssets} WHERE a.pinned = true ORDER BY a.updated_at DESC`, [adult, identity.userId ?? null]),
        pool.query(`SELECT type, count(*)::int AS count FROM library_assets GROUP BY type`),
      ]);
      const countMap = Object.fromEntries(assetTypes.map((type) => [type, 0]));
      for (const row of counts.rows) countMap[row.type] = row.count;
      response.json({
        recent: recent.rows.map((row) => mapAsset(row, identity.userId, identity.isSuperAdmin)),
        pinned: pinned.rows.map((row) => mapAsset(row, identity.userId, identity.isSuperAdmin)),
        counts: countMap,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/assets', async (request, response, next) => {
    try {
      const identity = requestIdentity(request);
      const values: unknown[] = [canViewAdult(request), identity.userId ?? null];
      const where: string[] = [];
      const type = typeof request.query.type === 'string' && assetTypes.includes(request.query.type as typeof assetTypes[number]) ? request.query.type : undefined;
      const sourceType = typeof request.query.sourceType === 'string' && sourceTypes.includes(request.query.sourceType as typeof sourceTypes[number]) ? request.query.sourceType : undefined;
      const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 120) : '';
      if (type) { values.push(type); where.push(`a.type = $${values.length}`); }
      if (sourceType) { values.push(sourceType); where.push(`a.source_type = $${values.length}`); }
      if (search) {
        values.push(`%${search}%`);
        where.push(`(a.content_rating = 'adult' AND NOT $1::boolean OR a.name ILIKE $${values.length} OR a.summary ILIKE $${values.length} OR sc.code ILIKE $${values.length} OR $${values.length} = ANY(a.tags))`);
      }
      const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const order = request.query.sort === 'name' ? 'a.name ASC' : 'a.updated_at DESC';
      const result = await pool.query(`${selectAssets}${clause} ORDER BY ${order} LIMIT 200`, values);
      response.json({ items: result.rows.map((row) => mapAsset(row, identity.userId, identity.isSuperAdmin)), total: result.rowCount });
    } catch (error) {
      next(error);
    }
  });

  router.get('/assets/:id', async (request, response, next) => {
    try {
      if (request.params.id.startsWith('restricted:')) return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
      const identity = requestIdentity(request);
      const result = await pool.query(`${selectAssets} WHERE a.id = $3`, [canViewAdult(request), identity.userId ?? null, request.params.id]);
      if (!result.rowCount) return response.status(404).json({ error: 'Record not found.' });
      if (result.rows[0].restricted) return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
      response.json(mapAsset(result.rows[0], identity.userId, identity.isSuperAdmin));
    } catch (error) {
      next(error);
    }
  });

  router.post('/assets', requireCreator(config, pool, settingsStore), async (request, response, next) => {
    try {
      const asset = createAssetSchema.parse(request.body);
      const result = await pool.query(
        `INSERT INTO library_assets (id,type,name,summary,origin_world_id,creator_user_id,source_type,content_rating,tags,visual_tone,document)
         VALUES ($1,$2,$3,$4,$5,$6,'user-created',$7,$8,$9,$10::jsonb) RETURNING *`,
        [randomUUID(), asset.type, asset.name, asset.summary, asset.originWorldId ?? null, request.session.userId, asset.contentRating, asset.tags, asset.visualTone, JSON.stringify(asset.document)],
      );
      const registry = await pool.query('SELECT code, classification FROM speculus_catalog_registry WHERE asset_id = $1', [result.rows[0].id]);
      response.status(201).json(mapAsset({
        ...result.rows[0],
        restricted: false,
        speculus_code: registry.rows[0]?.code,
        speculus_classification: registry.rows[0]?.classification,
      }, request.session.userId));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/assets/:id', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to edit this record.' });
      const asset = updateAssetSchema.parse(request.body);
      const current = await pool.query('SELECT * FROM library_assets WHERE id = $1', [request.params.id]);
      if (!current.rowCount) return response.status(404).json({ error: 'Record not found.' });
      const isSuperAdmin = request.session.discordUserId === SUPER_ADMIN_DISCORD_ID;
      if (current.rows[0].creator_user_id !== request.session.userId && !isSuperAdmin) return response.status(403).json({ error: 'Only the creator can change this record.' });
      const nextAsset = { ...current.rows[0], ...{
        name: asset.name ?? current.rows[0].name,
        summary: asset.summary ?? current.rows[0].summary,
        origin_world_id: asset.originWorldId === undefined ? current.rows[0].origin_world_id : asset.originWorldId,
        content_rating: asset.contentRating ?? current.rows[0].content_rating,
        tags: asset.tags ?? current.rows[0].tags,
        visual_tone: asset.visualTone ?? current.rows[0].visual_tone,
        document: asset.document ?? current.rows[0].document ?? {},
      }};
      if (Object.prototype.hasOwnProperty.call(nextAsset.document, 'name')) nextAsset.document.name = nextAsset.name;
      if (Object.prototype.hasOwnProperty.call(nextAsset.document, 'title')) nextAsset.document.title = nextAsset.name;
      const identity = nextAsset.document.identity;
      if (identity && typeof identity === 'object' && 'name' in (identity as Record<string, unknown>)) (identity as Record<string, unknown>).name = nextAsset.name;
      const result = await pool.query(
        `UPDATE library_assets SET name=$2, summary=$3, origin_world_id=$4, content_rating=$5, tags=$6, visual_tone=$7, document=$8::jsonb, updated_at=now()
         WHERE id=$1 RETURNING *`,
        [request.params.id, nextAsset.name, nextAsset.summary, nextAsset.origin_world_id, nextAsset.content_rating, nextAsset.tags, nextAsset.visual_tone, JSON.stringify(nextAsset.document)],
      );
      const [author, registry] = await Promise.all([
        pool.query('SELECT display_name, avatar_url FROM users WHERE id = $1', [current.rows[0].creator_user_id]),
        pool.query('SELECT code, classification FROM speculus_catalog_registry WHERE asset_id = $1', [request.params.id]),
      ]);
      response.json(mapAsset({
        ...result.rows[0],
        restricted: false,
        author_name: author.rows[0]?.display_name,
        author_avatar_url: author.rows[0]?.avatar_url,
        speculus_code: registry.rows[0]?.code,
        speculus_classification: registry.rows[0]?.classification,
      }, request.session.userId, isSuperAdmin));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
