import { Router, type Request } from 'express';
import { z } from 'zod';
import { applyAssetUpdate, assetTypes, createAssetSchema, insertAsset, updateAssetSchema } from './asset-writes.js';
import type { AdminViewPreferenceStore } from './admin-view-preferences.js';
import { ensureSuperAdminAccess, refreshSessionAccess, requireCreator, SUPER_ADMIN_DISCORD_ID } from './auth.js';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import { loadAssetImages, type AssetImageResponse } from './media.js';
import type { SettingsStore } from './settings.js';
import { canDirectViewAssetRow, canDiscoverAssetRow } from './world-access.js';
import { hydrateWorldDocument } from './world-projection-read.js';

const sourceTypes = ['curated', 'user-created', 'imported-v2', 'copied', 'public-curated', 'legacy-import'] as const;

function canViewAdult(request: Request) {
  return request.session.access?.canViewAdult === true;
}

function mapAsset(row: Record<string, unknown>, userId?: string, isSuperAdmin = false, images: AssetImageResponse[] = []) {
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
  const originalCreatorId = row.original_creator_user_id ?? row.creator_user_id;
  const coverImage = images.find((image) => image.kind === 'cover');
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
    coverImage,
    images,
    imageCount: images.length,
    speculus: row.speculus_code ? {
      code: String(row.speculus_code),
      classification: String(row.speculus_classification ?? ''),
    } : undefined,
    canEdit: isSuperAdmin || Boolean(userId && row.creator_user_id === userId),
    isOwner: Boolean(userId && row.creator_user_id === userId),
    author: originalCreatorId ? { id: originalCreatorId, displayName: row.author_name, avatarUrl: row.author_avatar_url ?? undefined } : undefined,
    owner: row.creator_user_id ? { id: row.creator_user_id, displayName: row.owner_name, avatarUrl: row.owner_avatar_url ?? undefined } : undefined,
  };
}

const selectAssets = `
  SELECT a.*, origin.name AS origin_world_name,
    origin.document AS origin_world_document,
    origin.creator_user_id AS origin_world_creator_user_id,
    author.display_name AS author_name, author.avatar_url AS author_avatar_url,
    owner_user.display_name AS owner_name, owner_user.avatar_url AS owner_avatar_url,
    sc.code AS speculus_code, sc.classification AS speculus_classification,
    (a.content_rating = 'adult' AND NOT $1::boolean AND a.creator_user_id IS DISTINCT FROM $2::uuid) AS restricted
  FROM library_assets a
  LEFT JOIN library_assets origin ON origin.id = a.origin_world_id
  LEFT JOIN users author ON author.id = COALESCE(a.original_creator_user_id, a.creator_user_id)
  LEFT JOIN users owner_user ON owner_user.id = a.creator_user_id
  LEFT JOIN speculus_catalog_registry sc ON sc.asset_id = a.id`;

const selectAccessRows = `
  SELECT a.type, a.creator_user_id, a.document,
    origin.document AS origin_world_document,
    origin.creator_user_id AS origin_world_creator_user_id
  FROM library_assets a
  LEFT JOIN library_assets origin ON origin.id = a.origin_world_id`;

function baseIdentity(request: Request) {
  return {
    userId: request.session.userId,
    isSuperAdmin: request.session.discordUserId === SUPER_ADMIN_DISCORD_ID,
  };
}

export function createLibraryRouter(
  config: AppConfig,
  pool: DatabasePool,
  settingsStore: SettingsStore,
  adminViewPreferences: AdminViewPreferenceStore,
) {
  const router = Router();

  /**
   * Discovery identity. `canSeePrivateWorlds` is the super-admin recovery
   * capability and is used only for direct view, so a direct link to a private
   * world keeps working. `hidePrivateUserWorlds` is the separate admin browsing
   * preference that narrows what the admin's own library lists show.
   */
  const requestIdentity = async (request: Request) => {
    const identity = baseIdentity(request);
    const preferences = identity.isSuperAdmin && identity.userId
      ? await adminViewPreferences.get(identity.userId)
      : { hidePrivateUserWorlds: false };
    return { ...identity, canSeePrivateWorlds: identity.isSuperAdmin, hidePrivateUserWorlds: preferences.hidePrivateUserWorlds };
  };

  /** The admin private-world filter applies to discovery only, never to direct view. */
  const canDiscover = (row: Record<string, unknown>, identity: Awaited<ReturnType<typeof requestIdentity>>) =>
    canDiscoverAssetRow(row, identity.userId, identity.isSuperAdmin, { hidePrivateUserWorlds: identity.hidePrivateUserWorlds });

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
      const identity = await requestIdentity(request);
      const [recent, pinned, countRows] = await Promise.all([
        pool.query(`${selectAssets} ORDER BY a.updated_at DESC LIMIT 40`, [adult, identity.userId ?? null]),
        pool.query(`${selectAssets} WHERE a.pinned = true ORDER BY a.updated_at DESC`, [adult, identity.userId ?? null]),
        pool.query(selectAccessRows),
      ]);
      const countMap = Object.fromEntries(assetTypes.map((type) => [type, 0]));
      for (const row of countRows.rows) {
        if (canDiscover(row, identity)) countMap[row.type] = (countMap[row.type] ?? 0) + 1;
      }
      const discoveredRecent = recent.rows.filter((row) => canDiscover(row, identity)).slice(0, 4);
      const discoveredPinned = pinned.rows.filter((row) => canDiscover(row, identity));
      const images = await loadAssetImages(pool, [...new Set([...discoveredRecent, ...discoveredPinned].map((row) => String(row.id)))]);
      response.json({
        recent: discoveredRecent.map((row) => mapAsset(row, identity.userId, identity.isSuperAdmin, images.get(String(row.id)) ?? [])),
        pinned: discoveredPinned.map((row) => mapAsset(row, identity.userId, identity.isSuperAdmin, images.get(String(row.id)) ?? [])),
        counts: countMap,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/assets', async (request, response, next) => {
    try {
      const identity = await requestIdentity(request);
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
      const result = await pool.query(`${selectAssets}${clause} ORDER BY ${order} LIMIT 400`, values);
      const visibleRows = result.rows
        .filter((row) => canDiscover(row, identity))
        .slice(0, 200);
      const images = await loadAssetImages(pool, visibleRows.map((row) => String(row.id)));
      response.json({
        items: visibleRows.map((row) => mapAsset(row, identity.userId, identity.isSuperAdmin, images.get(String(row.id)) ?? [])),
        total: visibleRows.length,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/assets/:id', async (request, response, next) => {
    try {
      if (request.params.id.startsWith('restricted:')) return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
      const identity = await requestIdentity(request);
      const result = await pool.query(`${selectAssets} WHERE a.id = $3`, [canViewAdult(request), identity.userId ?? null, request.params.id]);
      if (!result.rowCount) return response.status(404).json({ error: 'Record not found.' });
      const row = result.rows[0] as Record<string, unknown>;
      if (!canDirectViewAssetRow(row, identity.userId, identity.canSeePrivateWorlds)) return response.status(404).json({ error: 'Record not found.' });
      if (row.restricted) return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
      if (row.type === 'world') {
        row.document = await hydrateWorldDocument(pool, String(row.id), row.document);
      }
      const images = await loadAssetImages(pool, [String(row.id)]);
      response.json(mapAsset(row, identity.userId, identity.isSuperAdmin, images.get(String(row.id)) ?? []));
    } catch (error) {
      next(error);
    }
  });

  router.post('/assets', requireCreator(config, pool, settingsStore), async (request, response, next) => {
    try {
      const isSuperAdmin = request.session.discordUserId === SUPER_ADMIN_DISCORD_ID;
      const { row, result } = await insertAsset(pool, { userId: request.session.userId!, isSuperAdmin }, request.body, 'editor');
      const registry = await pool.query('SELECT code, classification FROM speculus_catalog_registry WHERE asset_id = $1', [row.id]);
      response.status(201).json({
        ...mapAsset({
          ...row,
          restricted: false,
          speculus_code: registry.rows[0]?.code,
          speculus_classification: registry.rows[0]?.classification,
        }, request.session.userId),
        revision: result.revision,
        changedFields: result.changedFields,
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/assets/:id', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to edit this record.' });
      const isSuperAdmin = request.session.discordUserId === SUPER_ADMIN_DISCORD_ID;
      const { row, result } = await applyAssetUpdate(pool, { userId: request.session.userId, isSuperAdmin }, request.params.id, request.body, 'editor');
      const originalCreatorId = row.original_creator_user_id ?? row.creator_user_id;
      const [author, owner, registry] = await Promise.all([
        pool.query('SELECT display_name, avatar_url FROM users WHERE id = $1', [originalCreatorId]),
        pool.query('SELECT display_name, avatar_url FROM users WHERE id = $1', [row.creator_user_id]),
        pool.query('SELECT code, classification FROM speculus_catalog_registry WHERE asset_id = $1', [request.params.id]),
      ]);
      response.json({
        ...mapAsset({
          ...row,
          restricted: false,
          author_name: author.rows[0]?.display_name,
          author_avatar_url: author.rows[0]?.avatar_url,
          owner_name: owner.rows[0]?.display_name,
          owner_avatar_url: owner.rows[0]?.avatar_url,
          speculus_code: registry.rows[0]?.code,
          speculus_classification: registry.rows[0]?.classification,
        }, request.session.userId, isSuperAdmin),
        revision: result.revision,
        changedFields: result.changedFields,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
