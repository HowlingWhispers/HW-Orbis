import { createHash } from 'node:crypto';
import express, { Router, type Request } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ensureSuperAdminAccess, refreshSessionAccess, requireCreator, SUPER_ADMIN_DISCORD_ID } from './auth.js';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';
import type { SettingsStore } from './settings.js';

const assetTypes = ['world', 'character', 'place', 'item', 'faction', 'species', 'society', 'family', 'memory'] as const;
const sourceTypes = ['curated', 'user-created', 'imported-v2', 'copied', 'public-curated', 'legacy-import'] as const;
const tones = ['moon', 'forest', 'ember', 'mist', 'violet', 'river'] as const;
const statuses = ['active', 'archived', 'retired', 'sealed'] as const;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

const documentSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 128_000,
  'A record document exceeds Orbis’s 128 KB limit.',
);

const registrySchema = z.object({
  prefix: z.string().regex(/^[A-Z]$/),
  ordinal: z.number().int().safe().positive(),
  generation: z.number().int().positive(),
  series: z.string().regex(/^[A-Z]{2}$/),
  number: z.number().int().min(1).max(99999),
  plate: z.string().regex(/^[A-Z]{2}[0-9]{5}$/),
  code: z.string().min(1).max(80),
  classification: z.string().min(1).max(120),
  status: z.enum(statuses),
  assignedAt: z.string().datetime(),
  retiredAt: z.string().datetime().nullable(),
  registryNumber: z.number().int().safe().positive(),
  assetCreatedAt: z.string().datetime(),
});

const recordSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(assetTypes),
  name: z.string().trim().min(1).max(120),
  summary: z.string().max(2000),
  originWorldId: z.string().uuid().nullable(),
  sourceType: z.enum(sourceTypes),
  sourceAssetId: z.string().max(500).nullable(),
  contentRating: z.enum(['sfw', 'adult']),
  tags: z.array(z.string().min(1).max(40)).max(20),
  dependencyCount: z.number().int().safe().min(0),
  pinned: z.boolean(),
  visualTone: z.enum(tones),
  document: documentSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  speculus: registrySchema,
});

const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('record'), rootAssetId: z.string().uuid() }),
  z.object({ kind: z.literal('world'), rootAssetId: z.string().uuid() }),
  z.object({ kind: z.literal('account') }),
]);

const archiveBodySchema = z.object({
  format: z.literal('orbis-transfer'),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  scope: scopeSchema,
  records: z.array(recordSchema).min(1).max(10_000),
});

const archiveSchema = archiveBodySchema.extend({ sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export type OrbisTransferArchive = z.infer<typeof archiveSchema>;
type TransferRecord = z.infer<typeof recordSchema>;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const asIso = (value: unknown) => new Date(String(value)).toISOString();

function registryFromRow(row: Record<string, unknown>): TransferRecord['speculus'] {
  if (!row.speculus_code) throw new Error(`Record ${String(row.id)} has no SPC registry entry.`);
  return {
    prefix: String(row.speculus_prefix),
    ordinal: Number(row.speculus_ordinal),
    generation: Number(row.speculus_generation),
    series: String(row.speculus_series),
    number: Number(row.speculus_number),
    plate: String(row.speculus_plate),
    code: String(row.speculus_code),
    classification: String(row.speculus_classification),
    status: String(row.speculus_status) as TransferRecord['speculus']['status'],
    assignedAt: asIso(row.speculus_assigned_at),
    retiredAt: row.speculus_retired_at ? asIso(row.speculus_retired_at) : null,
    registryNumber: Number(row.speculus_registry_number),
    assetCreatedAt: asIso(row.speculus_asset_created_at),
  };
}

function recordFromRow(row: Record<string, unknown>): TransferRecord {
  return recordSchema.parse({
    id: row.id,
    type: row.type,
    name: row.name,
    summary: row.summary ?? '',
    originWorldId: row.origin_world_id ?? null,
    sourceType: row.source_type,
    sourceAssetId: row.source_asset_id ?? null,
    contentRating: row.content_rating,
    tags: row.tags ?? [],
    dependencyCount: Number(row.dependency_count ?? 0),
    pinned: row.pinned === true,
    visualTone: row.visual_tone,
    document: row.document ?? {},
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    speculus: registryFromRow(row),
  });
}

export function buildTransferArchive(scope: z.infer<typeof scopeSchema>, rows: Array<Record<string, unknown>>, exportedAt = new Date()) {
  const body = archiveBodySchema.parse({
    format: 'orbis-transfer',
    version: 1,
    exportedAt: exportedAt.toISOString(),
    scope,
    records: rows.map(recordFromRow),
  });
  const ids = body.records.map((record) => record.id);
  if (new Set(ids).size !== ids.length) throw new Error('Archive contains duplicate record IDs.');
  const registryCodes = body.records.map((record) => record.speculus.code);
  if (new Set(registryCodes).size !== registryCodes.length) throw new Error('Archive contains duplicate SPC codes.');
  return { ...body, sha256: sha256(JSON.stringify(body)) } satisfies OrbisTransferArchive;
}

export function parseTransferArchive(raw: string): OrbisTransferArchive {
  const archive = archiveSchema.parse(JSON.parse(raw));
  const { sha256: suppliedChecksum, ...body } = archive;
  if (sha256(JSON.stringify(body)) !== suppliedChecksum) throw new Error('Archive checksum does not match. The file may be damaged or altered.');
  const ids = archive.records.map((record) => record.id);
  if (new Set(ids).size !== ids.length) throw new Error('Archive contains duplicate record IDs.');
  const codes = archive.records.map((record) => record.speculus.code);
  if (new Set(codes).size !== codes.length) throw new Error('Archive contains duplicate SPC codes.');
  const recordsById = new Map(archive.records.map((record) => [record.id, record]));
  for (const record of archive.records) {
    const includedOrigin = record.originWorldId ? recordsById.get(record.originWorldId) : undefined;
    if (includedOrigin && includedOrigin.type !== 'world') throw new Error(`${record.name} points to an origin record that is not a world.`);
  }
  return archive;
}

const exportSelect = `
  SELECT a.*,
    r.prefix AS speculus_prefix, r.ordinal AS speculus_ordinal,
    r.generation AS speculus_generation, r.series AS speculus_series,
    r.number AS speculus_number, r.plate AS speculus_plate,
    r.code AS speculus_code, r.classification AS speculus_classification,
    r.status AS speculus_status, r.assigned_at AS speculus_assigned_at,
    r.retired_at AS speculus_retired_at, r.registry_number AS speculus_registry_number,
    r.asset_created_at AS speculus_asset_created_at
  FROM library_assets a
  LEFT JOIN speculus_catalog_registry r ON r.asset_id = a.id`;

const safeSlug = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'orbis-record';

function sendArchive(response: express.Response, archive: OrbisTransferArchive, filename: string) {
  const body = `${JSON.stringify(archive, null, 2)}\n`;
  response.set({
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${safeSlug(filename)}.orbis.json"`,
    'Content-Type': 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'X-Orbis-SHA256': archive.sha256,
  });
  response.send(body);
}

export function createArchiveTransferRouter(config: AppConfig, pool: DatabasePool, settingsStore: SettingsStore) {
  const router = Router();

  router.use(async (request, _response, next) => {
    try {
      const isSuperAdmin = await ensureSuperAdminAccess(request, pool);
      if (!isSuperAdmin) await refreshSessionAccess(request, config, settingsStore);
      next();
    } catch (error) { next(error); }
  });

  router.get('/transfer/assets/:id', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to download a record.' });
      const rootResult = await pool.query(`${exportSelect} WHERE a.id = $1`, [request.params.id]);
      if (!rootResult.rowCount) return response.status(404).json({ error: 'Record not found.' });
      const root = rootResult.rows[0];
      const isSuperAdmin = request.session.discordUserId === SUPER_ADMIN_DISCORD_ID;
      if (root.creator_user_id !== request.session.userId && !isSuperAdmin) return response.status(403).json({ error: 'Only the owner can download this record.' });

      let rows = rootResult.rows;
      let scope: z.infer<typeof scopeSchema> = { kind: 'record', rootAssetId: String(root.id) };
      if (root.type === 'world') {
        const worldResult = await pool.query(`${exportSelect} WHERE a.id = $1 OR a.origin_world_id = $1 ORDER BY CASE WHEN a.id = $1 THEN 0 ELSE 1 END, a.created_at, a.id`, [root.id]);
        const foreignRecord = worldResult.rows.find((row) => row.creator_user_id !== root.creator_user_id);
        if (foreignRecord) return response.status(409).json({ error: 'This world contains records owned by another account and cannot be exported as one owner archive.' });
        rows = worldResult.rows;
        scope = { kind: 'world', rootAssetId: String(root.id) };
      }
      const archive = buildTransferArchive(scope, rows);
      sendArchive(response, archive, root.type === 'world' ? `${root.name}-world` : `${root.name}-${root.speculus_code}`);
    } catch (error) { next(error); }
  });

  router.get('/transfer/account', async (request, response, next) => {
    try {
      if (!request.session.userId) return response.status(401).json({ error: 'Sign in with Discord to download your archive.' });
      const result = await pool.query(`${exportSelect} WHERE a.creator_user_id = $1 ORDER BY CASE WHEN a.type = 'world' THEN 0 ELSE 1 END, a.created_at, a.id`, [request.session.userId]);
      if (!result.rowCount) return response.status(404).json({ error: 'This account has no records to download.' });
      sendArchive(response, buildTransferArchive({ kind: 'account' }, result.rows), `orbis-account-${new Date().toISOString().slice(0, 10)}`);
    } catch (error) { next(error); }
  });

  router.post('/transfer/import', requireCreator(config, pool, settingsStore), express.raw({ type: 'application/octet-stream', limit: MAX_ARCHIVE_BYTES }), async (request: Request, response, next) => {
    let client: PoolClient | undefined;
    try {
      if (!Buffer.isBuffer(request.body)) return response.status(415).json({ error: 'Upload an Orbis .orbis.json archive.' });
      let archive: OrbisTransferArchive;
      try { archive = parseTransferArchive(request.body.toString('utf8')); }
      catch (error) { return response.status(400).json({ error: error instanceof Error ? error.message : 'Invalid Orbis archive.' }); }

      client = await pool.connect();
      await client.query('BEGIN');
      const ids = archive.records.map((record) => record.id);
      const existing = await client.query('SELECT id FROM library_assets WHERE id = ANY($1::uuid[])', [ids]);
      if (existing.rowCount) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: 'One or more records already exist. Nothing was imported.' });
      }

      const codes = archive.records.map((record) => record.speculus.code);
      const registryNumbers = archive.records.map((record) => record.speculus.registryNumber);
      const plates = archive.records.map((record) => `${record.speculus.generation}:${record.speculus.plate}`);
      const ordinals = archive.records.map((record) => `${record.speculus.prefix}:${record.speculus.ordinal}`);
      const registryConflicts = await client.query(
        `SELECT asset_id FROM speculus_catalog_registry
         WHERE code = ANY($1::text[]) OR registry_number = ANY($2::bigint[])
           OR generation::text || ':' || plate = ANY($3::text[])
           OR prefix || ':' || ordinal::text = ANY($4::text[]) LIMIT 1`,
        [codes, registryNumbers, plates, ordinals],
      );
      if (registryConflicts.rowCount) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: 'An SPC identity from this archive already exists. Nothing was imported.' });
      }

      const includedIds = new Set(ids);
      const externalOrigins = [...new Set(archive.records.map((record) => record.originWorldId).filter((id): id is string => Boolean(id) && !includedIds.has(id!)))];
      if (externalOrigins.length) {
        const origins = await client.query('SELECT id, type, creator_user_id FROM library_assets WHERE id = ANY($1::uuid[])', [externalOrigins]);
        if (origins.rowCount !== externalOrigins.length || origins.rows.some((row: Record<string, unknown>) => row.type !== 'world' || row.creator_user_id !== request.session.userId)) {
          await client.query('ROLLBACK');
          return response.status(409).json({ error: 'The archive refers to an origin world that is not present under this account. Nothing was imported.' });
        }
      }

      const ordered = [...archive.records].sort((left, right) => Number(right.type === 'world') - Number(left.type === 'world'));
      for (const record of ordered) {
        await client.query(
          `INSERT INTO library_assets (
             id, type, name, summary, origin_world_id, creator_user_id, source_type, source_asset_id,
             content_rating, tags, dependency_count, pinned, visual_tone, document, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)`,
          [record.id, record.type, record.name, record.summary, record.originWorldId, request.session.userId,
            record.sourceType, record.sourceAssetId, record.contentRating, record.tags, record.dependencyCount,
            record.pinned, record.visualTone, JSON.stringify(record.document), record.createdAt, record.updatedAt],
        );
      }

      await client.query('DELETE FROM speculus_catalog_registry WHERE asset_id = ANY($1::uuid[])', [ids]);
      for (const record of archive.records) {
        const registry = record.speculus;
        await client.query(
          `INSERT INTO speculus_catalog_registry (
             asset_id, prefix, ordinal, generation, series, number, plate, code, classification,
             status, assigned_at, retired_at, registry_number, asset_created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [record.id, registry.prefix, registry.ordinal, registry.generation, registry.series, registry.number,
            registry.plate, registry.code, registry.classification, registry.status, registry.assignedAt,
            registry.retiredAt, registry.registryNumber, registry.assetCreatedAt],
        );
      }
      const maxOrdinals = new Map<string, number>();
      for (const record of archive.records) maxOrdinals.set(record.speculus.prefix, Math.max(maxOrdinals.get(record.speculus.prefix) ?? 0, record.speculus.ordinal));
      for (const [prefix, ordinal] of maxOrdinals) {
        await client.query(
          `INSERT INTO speculus_catalog_sequences (prefix, next_ordinal) VALUES ($1,$2)
           ON CONFLICT (prefix) DO UPDATE SET next_ordinal = GREATEST(speculus_catalog_sequences.next_ordinal, EXCLUDED.next_ordinal)`,
          [prefix, ordinal + 1],
        );
      }
      await client.query('COMMIT');
      response.status(201).json({ imported: archive.records.length, scope: archive.scope, sha256: archive.sha256 });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (code === '23505' || code === '23503') return response.status(409).json({ error: 'The archive conflicts with existing records. Nothing was imported.' });
      next(error);
    } finally { client?.release(); }
  });

  return router;
}
