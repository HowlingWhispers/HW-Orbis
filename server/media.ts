import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import express from 'express';
import { z } from 'zod';
import {
  AssetImageError, assetImageMediaRoot, externalImageSchema, imageMetadataSchema, imageUpdateSchema, MAX_LOCAL_IMAGE_BYTES,
  removeLocalImage, resolveStoredImagePath, storeLocalImage,
} from './asset-images.js';
import { ensureSuperAdminAccess, SUPER_ADMIN_DISCORD_ID } from './auth.js';
import type { AppConfig } from './config.js';
import type { DatabaseExecutor, DatabasePool } from './db.js';
import { canDirectViewAssetRow, isAdultRestrictedAssetRow } from './world-access.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const plainImageColumns = `
  id, asset_id, kind, storage_kind, storage_path, external_url, file_name,
  mime_type, byte_size, width, height, caption, alt_text, focal_x, focal_y,
  position, created_at, updated_at`;

const imageColumns = plainImageColumns
  .split(',')
  .map((column) => `i.${column.trim()}`)
  .join(', ');

/** Access context for an asset, mirroring the library asset query projection. */
const assetAccessSelect = `
  SELECT a.id, a.type, a.name, a.creator_user_id, a.content_rating, a.document,
    origin.document AS origin_world_document,
    origin.creator_user_id AS origin_world_creator_user_id
  FROM library_assets a
  LEFT JOIN library_assets origin ON origin.id = a.origin_world_id`;

export interface AssetImageResponse {
  id: string;
  assetId: string;
  kind: 'cover' | 'gallery';
  storageKind: 'local' | 'external';
  url: string;
  fileName?: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  caption?: string;
  altText?: string;
  focalX: number;
  focalY: number;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Local artwork is addressed API-relative, the same way every other Orbis client
 * request is built: the web app prepends its configured API base, which keeps
 * this correct whether the API is same-origin or hosted separately.
 */
export function mediaUrlForImage(imageId: string) {
  return `/v1/library/media/${imageId}`;
}

export function mapAssetImage(row: Record<string, unknown>): AssetImageResponse {
  const storageKind = String(row.storage_kind);
  return {
    id: String(row.id),
    assetId: String(row.asset_id),
    kind: row.kind as 'cover' | 'gallery',
    storageKind: storageKind as 'local' | 'external',
    url: storageKind === 'external' ? String(row.external_url) : mediaUrlForImage(String(row.id)),
    fileName: row.file_name ? String(row.file_name) : undefined,
    mimeType: String(row.mime_type),
    byteSize: Number(row.byte_size ?? 0),
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    caption: row.caption ? String(row.caption) : undefined,
    altText: row.alt_text ? String(row.alt_text) : undefined,
    focalX: Number(row.focal_x ?? 0.5),
    focalY: Number(row.focal_y ?? 0.5),
    position: Number(row.position ?? 0),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

/** Cover and gallery for a set of assets in one query, to keep list views free of N+1 lookups. */
export async function loadAssetImages(pool: DatabasePool, assetIds: string[]) {
  const images = new Map<string, AssetImageResponse[]>();
  if (!assetIds.length) return images;
  const result = await pool.query(
    `SELECT ${imageColumns} FROM library_asset_images i WHERE i.asset_id = ANY($1::uuid[])
     ORDER BY (i.kind = 'cover') DESC, i.position ASC, i.created_at ASC`,
    [assetIds],
  );
  for (const row of result.rows) {
    const list = images.get(String(row.asset_id)) ?? [];
    list.push(mapAssetImage(row));
    images.set(String(row.asset_id), list);
  }
  return images;
}

function requestIdentity(request: Request) {
  return {
    userId: request.session.userId,
    isSuperAdmin: request.session.discordUserId === SUPER_ADMIN_DISCORD_ID,
  };
}

function canViewAdult(request: Request) {
  return request.session.access?.canViewAdult === true;
}

async function loadAssetForAccess(pool: DatabasePool, assetId: string) {
  const result = await pool.query(`${assetAccessSelect} WHERE a.id = $1`, [assetId]);
  return result.rowCount ? result.rows[0] as Record<string, unknown> : null;
}

function assertUuid(value: string, label: string) {
  if (!uuidPattern.test(value)) throw new AssetImageError(400, `Use an exact Orbis ${label} ID.`);
  return value;
}

/**
 * Image writes follow the same ownership rule as record writes: the controlling
 * owner of the record, or an Orbis super-admin. Original creator provenance,
 * privacy and publication state are untouched by image edits.
 */
function assertCanEditAssetImages(asset: Record<string, unknown>, identity: ReturnType<typeof requestIdentity>) {
  if (!identity.userId) throw new AssetImageError(401, 'Sign in with Discord to change images on this record.');
  if (asset.creator_user_id !== identity.userId && !identity.isSuperAdmin) {
    throw new AssetImageError(403, 'Only the record owner can change its images.');
  }
}

/**
 * Run image writes in a transaction when a real pool is available. Unit tests
 * intentionally use query-only executors, so those fall through to the caller
 * unchanged rather than being forced to fake transactions.
 */
async function inTransaction<T>(pool: DatabasePool, work: (client: DatabaseExecutor) => Promise<T>) {
  const maybePool = pool as unknown as { connect?: () => Promise<DatabaseExecutor & { release: () => void }> };
  if (typeof maybePool.connect !== 'function') return work(pool);

  const client = await maybePool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * A record has exactly one cover. Promoting an image demotes the previous cover
 * into the gallery rather than deleting it, and the partial unique index on
 * `kind = 'cover'` makes a second cover impossible even under concurrent writes.
 */
async function demoteOtherCovers(client: DatabaseExecutor, assetId: string, imageId: string) {
  await client.query(
    `UPDATE library_asset_images SET kind = 'gallery', updated_at = now()
     WHERE asset_id = $1 AND kind = 'cover' AND id <> $2`,
    [assetId, imageId],
  );
}

async function nextGalleryPosition(client: DatabaseExecutor, assetId: string) {
  const result = await client.query(
    `SELECT COALESCE(max(position), -1) + 1 AS position FROM library_asset_images WHERE asset_id = $1 AND kind = 'gallery'`,
    [assetId],
  );
  return Number(result.rows[0]?.position ?? 0);
}

function sanitizeFileName(value: string | undefined) {
  if (!value) return undefined;
  const cleaned = value.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return cleaned || undefined;
}

const uploadBody = express.raw({ limit: MAX_LOCAL_IMAGE_BYTES, type: () => true });

/** Express raises a plain 413 for an oversized body; report it in Orbis' own words. */
function uploadLimitError(error: unknown, _request: Request, _response: Response, next: NextFunction) {
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    return next(new AssetImageError(413, `Orbis stores images up to ${Math.floor(MAX_LOCAL_IMAGE_BYTES / 1024)} KB each. Choose a smaller image, or link an external image URL instead.`));
  }
  next(error);
}

export function createMediaRouter(config: AppConfig, pool: DatabasePool) {
  const router = Router();

  router.use(async (request, _response, next) => {
    try {
      if (request.session.userId) await ensureSuperAdminAccess(request, pool);
      next();
    } catch (error) {
      next(error);
    }
  });

  /**
   * Access-controlled image delivery. Orbis never serves the media directory
   * statically, so private and adult artwork is gated by exactly the same rules
   * as the record it belongs to.
   */
  router.get('/media/:imageId', async (request, response, next) => {
    try {
      const imageId = assertUuid(String(request.params.imageId), 'image');
      const result = await pool.query(`SELECT ${imageColumns} FROM library_asset_images i WHERE i.id = $1`, [imageId]);
      if (!result.rowCount) return response.status(404).json({ error: 'Image not found.' });
      const image = result.rows[0] as Record<string, unknown>;
      if (String(image.storage_kind) !== 'local') return response.status(404).json({ error: 'Image not found.' });

      const identity = requestIdentity(request);
      const asset = await loadAssetForAccess(pool, String(image.asset_id));
      if (!asset) return response.status(404).json({ error: 'Image not found.' });
      if (!canDirectViewAssetRow(asset, identity.userId, identity.isSuperAdmin)) return response.status(404).json({ error: 'Image not found.' });
      if (isAdultRestrictedAssetRow(asset, identity.userId, canViewAdult(request))) {
        return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
      }

      const absolute = resolveStoredImagePath(config, String(image.storage_path));
      response.set('Content-Type', String(image.mime_type));
      // Private caching: the body is per-viewer and must never land in a shared cache.
      response.set('Cache-Control', 'private, max-age=3600');
      response.set('X-Content-Type-Options', 'nosniff');
      return response.sendFile(absolute, (error) => { if (error && !response.headersSent) next(error); });
    } catch (error) {
      next(error);
    }
  });

  router.get('/assets/:assetId/images', async (request, response, next) => {
    try {
      const assetId = assertUuid(String(request.params.assetId), 'record');
      const identity = requestIdentity(request);
      const asset = await loadAssetForAccess(pool, assetId);
      if (!asset) return response.status(404).json({ error: 'Record not found.' });
      if (!canDirectViewAssetRow(asset, identity.userId, identity.isSuperAdmin)) return response.status(404).json({ error: 'Record not found.' });
      if (isAdultRestrictedAssetRow(asset, identity.userId, canViewAdult(request))) {
        return response.status(403).json({ error: 'Verification required.', verificationPath: '/verification' });
      }
      const result = await pool.query(
        `SELECT ${imageColumns} FROM library_asset_images i WHERE i.asset_id = $1
         ORDER BY (i.kind = 'cover') DESC, i.position ASC, i.created_at ASC`,
        [assetId],
      );
      response.json({ items: result.rows.map(mapAssetImage) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/assets/:assetId/images', uploadLimitError, uploadBody, async (request: Request, response: Response, next: NextFunction) => {
    try {
      const assetId = assertUuid(String(request.params.assetId), 'record');
      const identity = requestIdentity(request);
      const asset = await loadAssetForAccess(pool, assetId);
      if (!asset) return response.status(404).json({ error: 'Record not found.' });
      assertCanEditAssetImages(asset, identity);

      if (Buffer.isBuffer(request.body)) {
        const metadata = imageMetadataSchema.parse({
          kind: request.query.kind,
          caption: request.query.caption,
          altText: request.query.altText,
          focalX: request.query.focalX,
          focalY: request.query.focalY,
          fileName: request.query.fileName,
        });
        // Bytes land on disk before the row exists, so a database failure can only
        // ever orphan a file; a row can never point at bytes that were not written.
        const stored = await storeLocalImage(config, assetId, request.body);
        try {
          const row = await inTransaction(pool, async (client) => {
            const position = metadata.kind === 'gallery' ? await nextGalleryPosition(client, assetId) : 0;
            const inserted = await client.query(
              `INSERT INTO library_asset_images
                 (id, asset_id, kind, storage_kind, storage_path, file_name, mime_type, byte_size, width, height, caption, alt_text, focal_x, focal_y, position, uploaded_by_user_id)
               VALUES ($1,$2,$3,'local',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
               RETURNING ${plainImageColumns}`,
              [stored.imageId, assetId, metadata.kind, stored.storagePath, sanitizeFileName(metadata.fileName) ?? null,
                stored.mimeType, stored.byteSize, stored.width, stored.height,
                metadata.caption ?? null, metadata.altText ?? null, metadata.focalX, metadata.focalY, position, identity.userId],
            );
            if (metadata.kind === 'cover') await demoteOtherCovers(client, assetId, stored.imageId);
            return inserted.rows[0] as Record<string, unknown>;
          });
          return response.status(201).json(mapAssetImage(row));
        } catch (error) {
          await removeLocalImage(config, stored.storagePath).catch(() => undefined);
          throw error;
        }
      }

      const external = externalImageSchema.parse(request.body);
      const row = await inTransaction(pool, async (client) => {
        const position = external.kind === 'gallery' ? await nextGalleryPosition(client, assetId) : 0;
        const inserted = await client.query(
          `INSERT INTO library_asset_images
             (asset_id, kind, storage_kind, external_url, mime_type, byte_size, caption, alt_text, focal_x, focal_y, position, uploaded_by_user_id)
           VALUES ($1,$2,'external',$3,'image/external',0,$4,$5,$6,$7,$8,$9)
           RETURNING ${plainImageColumns}`,
          [assetId, external.kind, external.url, external.caption ?? null, external.altText ?? null,
            external.focalX, external.focalY, position, identity.userId],
        );
        if (external.kind === 'cover') await demoteOtherCovers(client, assetId, String(inserted.rows[0].id));
        return inserted.rows[0] as Record<string, unknown>;
      });
      return response.status(201).json(mapAssetImage(row));
    } catch (error) {
      if (error instanceof z.ZodError) return response.status(400).json({ error: 'Those image details are not valid Orbis fields.', details: error.flatten() });
      next(error);
    }
  });

  router.patch('/assets/:assetId/images/:imageId', async (request, response, next) => {
    try {
      const assetId = assertUuid(String(request.params.assetId), 'record');
      const imageId = assertUuid(String(request.params.imageId), 'image');
      const identity = requestIdentity(request);
      const asset = await loadAssetForAccess(pool, assetId);
      if (!asset) return response.status(404).json({ error: 'Record not found.' });
      assertCanEditAssetImages(asset, identity);

      const update = imageUpdateSchema.parse(request.body ?? {});
      const row = await inTransaction(pool, async (client) => {
        const existing = await client.query('SELECT kind FROM library_asset_images WHERE id = $1 AND asset_id = $2', [imageId, assetId]);
        if (!existing.rowCount) throw new AssetImageError(404, 'Image not found.');
        const wasCover = String(existing.rows[0].kind) === 'cover';
        // Demote first: the partial unique index allows only one cover row, so the
        // old cover has to leave before the target can take the cover position.
        if (update.kind === 'cover' && !wasCover) await demoteOtherCovers(client, assetId, imageId);
        const updated = await client.query(
          `UPDATE library_asset_images
           SET caption = COALESCE($3, caption),
               alt_text = COALESCE($4, alt_text),
               focal_x = COALESCE($5, focal_x),
               focal_y = COALESCE($6, focal_y),
               position = COALESCE($7, position),
               kind = COALESCE($8, kind),
               updated_at = now()
           WHERE id = $1 AND asset_id = $2
           RETURNING ${plainImageColumns}`,
          [imageId, assetId,
            update.caption === undefined ? null : update.caption,
            update.altText === undefined ? null : update.altText,
            update.focalX ?? null, update.focalY ?? null, update.position ?? null, update.kind ?? null],
        );
        if (update.kind === 'gallery' && wasCover) {
          // The record is left without a cover on purpose; the UI keeps showing
          // generated tone artwork until the owner promotes another image.
          return updated.rows[0] as Record<string, unknown>;
        }
        return updated.rows[0] as Record<string, unknown>;
      });
      response.json(mapAssetImage(row));
    } catch (error) {
      if (error instanceof z.ZodError) return response.status(400).json({ error: 'Those image details are not valid Orbis fields.', details: error.flatten() });
      next(error);
    }
  });

  router.delete('/assets/:assetId/images/:imageId', async (request, response, next) => {
    try {
      const assetId = assertUuid(String(request.params.assetId), 'record');
      const imageId = assertUuid(String(request.params.imageId), 'image');
      const identity = requestIdentity(request);
      const asset = await loadAssetForAccess(pool, assetId);
      if (!asset) return response.status(404).json({ error: 'Record not found.' });
      assertCanEditAssetImages(asset, identity);

      const removed = await inTransaction(pool, async (client) => {
        const deleted = await client.query(
          'DELETE FROM library_asset_images WHERE id = $1 AND asset_id = $2 RETURNING storage_kind, storage_path',
          [imageId, assetId],
        );
        if (!deleted.rowCount) throw new AssetImageError(404, 'Image not found.');
        return deleted.rows[0] as Record<string, unknown>;
      });
      if (removed.storage_kind === 'local' && removed.storage_path) {
        await removeLocalImage(config, String(removed.storage_path)).catch(() => undefined);
      }
      response.json({ ok: true, imageId });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Delete local files no longer referenced by any `library_asset_images` row.
 * Rows cascade away with a deleted record; this keeps the media directory from
 * accumulating the bytes of images whose records are gone.
 */
export async function sweepOrphanedMediaFiles(config: AppConfig, pool: DatabasePool) {
  const root = assetImageMediaRoot(config);
  const referenced = new Set<string>();
  const stored = await pool.query(`SELECT storage_path FROM library_asset_images WHERE storage_kind = 'local' AND storage_path IS NOT NULL`);
  for (const row of stored.rows) referenced.add(String(row.storage_path));

  let removed = 0;
  let assetDirectories: string[];
  try {
    assetDirectories = await readdir(root, { withFileTypes: true }).then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  } catch {
    return 0;
  }
  for (const directory of assetDirectories) {
    const entries = await readdir(path.join(root, directory), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith('.part')) continue;
      const relativePath = path.posix.join(directory, entry.name);
      if (referenced.has(relativePath)) continue;
      await removeLocalImage(config, relativePath).catch(() => undefined);
      removed += 1;
    }
  }
  return removed;
}
