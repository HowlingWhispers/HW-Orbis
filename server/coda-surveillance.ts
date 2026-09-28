import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';

const attachmentSchema = z.object({
  id: z.string().max(32),
  name: z.string().max(300),
  size: z.number().int().nonnegative().max(100_000_000),
  contentType: z.string().max(200).nullable().optional(),
}).strict();

const surveillanceEventSchema = z.object({
  event: z.enum(['create', 'edit', 'delete']),
  messageId: z.string().regex(/^\d{17,20}$/),
  guildId: z.string().regex(/^\d{17,20}$/),
  channelId: z.string().regex(/^\d{17,20}$/),
  channelName: z.string().trim().max(120).optional().default(''),
  authorId: z.string().regex(/^\d{17,20}$/).optional(),
  authorName: z.string().trim().max(120).optional().default(''),
  authorUsername: z.string().trim().max(120).optional().default(''),
  authorBot: z.boolean().optional().default(false),
  content: z.string().max(8_000).optional().default(''),
  attachments: z.array(attachmentSchema).max(20).optional().default([]),
  replyToMessageId: z.string().regex(/^\d{17,20}$/).nullable().optional().default(null),
  createdAt: z.string().datetime({ offset: true }).optional(),
  editedAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

const memoryCreateSchema = z.object({
  guildId: z.string().regex(/^\d{17,20}$/),
  scope: z.enum(['server', 'user', 'channel', 'message']).optional().default('server'),
  subjectUserId: z.string().regex(/^\d{17,20}$/).nullable().optional().default(null),
  channelId: z.string().regex(/^\d{17,20}$/).nullable().optional().default(null),
  sourceMessageId: z.string().regex(/^\d{17,20}$/).nullable().optional().default(null),
  title: z.string().trim().max(200).optional().default(''),
  content: z.string().trim().min(1).max(12_000),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).optional().default([]),
  importance: z.number().int().min(1).max(5).optional().default(3),
  pinned: z.boolean().optional().default(false),
}).strict();

const memoryUpdateSchema = z.object({
  scope: z.enum(['server', 'user', 'channel', 'message']).optional(),
  subjectUserId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  channelId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  sourceMessageId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().min(1).max(12_000).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  pinned: z.boolean().optional(),
}).strict();

type SurveillanceEvent = z.infer<typeof surveillanceEventSchema>;

function authorized(config: AppConfig, authorization: string | undefined) {
  return Boolean(config.CODA_INTERNAL_BRIDGE_SECRET)
    && authorization === `Bearer ${config.CODA_INTERNAL_BRIDGE_SECRET}`;
}

async function recordCreate(pool: DatabasePool, body: SurveillanceEvent) {
  const createdAt = body.createdAt ?? new Date().toISOString();
  await pool.query(
    `INSERT INTO coda_surveillance_messages (
       discord_message_id, guild_id, channel_id, channel_name,
       author_id, author_name, author_username, author_bot,
       content, attachments, reply_to_message_id, message_created_at,
       edited_at, deleted_at, captured_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,NULL,NOW(),NOW())
     ON CONFLICT (discord_message_id) DO UPDATE SET
       guild_id = EXCLUDED.guild_id,
       channel_id = EXCLUDED.channel_id,
       channel_name = EXCLUDED.channel_name,
       author_id = EXCLUDED.author_id,
       author_name = EXCLUDED.author_name,
       author_username = EXCLUDED.author_username,
       author_bot = EXCLUDED.author_bot,
       content = EXCLUDED.content,
       attachments = EXCLUDED.attachments,
       reply_to_message_id = EXCLUDED.reply_to_message_id,
       message_created_at = EXCLUDED.message_created_at,
       edited_at = EXCLUDED.edited_at,
       deleted_at = NULL,
       updated_at = NOW()`,
    [
      body.messageId, body.guildId, body.channelId, body.channelName,
      body.authorId ?? '0', body.authorName, body.authorUsername, body.authorBot,
      body.content, JSON.stringify(body.attachments), body.replyToMessageId,
      createdAt, body.editedAt ?? null,
    ],
  );
  await pool.query(
    `INSERT INTO coda_surveillance_revisions (discord_message_id, event_type, content, attachments)
     VALUES ($1, 'create', $2, $3::jsonb)`,
    [body.messageId, body.content, JSON.stringify(body.attachments)],
  );
}

async function recordEdit(pool: DatabasePool, body: SurveillanceEvent) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT content, attachments FROM coda_surveillance_messages WHERE discord_message_id = $1 FOR UPDATE`,
      [body.messageId],
    );
    if (current.rowCount) {
      const previous = current.rows[0] as { content?: string; attachments?: unknown };
      // An edit revision stores the version that was replaced. That makes the
      // history useful without pretending the new text was the old revision.
      await client.query(
        `INSERT INTO coda_surveillance_revisions (discord_message_id, event_type, content, attachments)
         VALUES ($1, 'edit', $2, $3::jsonb)`,
        [body.messageId, previous.content ?? '', JSON.stringify(previous.attachments ?? [])],
      );
      await client.query(
        `UPDATE coda_surveillance_messages
            SET content = $2,
                attachments = $3::jsonb,
                edited_at = COALESCE($4::timestamptz, NOW()),
                channel_name = CASE WHEN $5 <> '' THEN $5 ELSE channel_name END,
                author_name = CASE WHEN $6 <> '' THEN $6 ELSE author_name END,
                author_username = CASE WHEN $7 <> '' THEN $7 ELSE author_username END,
                updated_at = NOW()
          WHERE discord_message_id = $1`,
        [body.messageId, body.content, JSON.stringify(body.attachments), body.editedAt ?? null, body.channelName, body.authorName, body.authorUsername],
      );
    } else {
      await client.query(
        `INSERT INTO coda_surveillance_messages (
           discord_message_id, guild_id, channel_id, channel_name,
           author_id, author_name, author_username, author_bot,
           content, attachments, reply_to_message_id, message_created_at,
           edited_at, captured_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,COALESCE($13::timestamptz,NOW()),NOW(),NOW())`,
        [
          body.messageId, body.guildId, body.channelId, body.channelName,
          body.authorId ?? '0', body.authorName, body.authorUsername, body.authorBot,
          body.content, JSON.stringify(body.attachments), body.replyToMessageId,
          body.createdAt ?? new Date().toISOString(), body.editedAt ?? null,
        ],
      );
      // We never saw the pre-edit text, so record only that an edited message
      // entered the archive; do not fabricate an earlier version.
      await client.query(
        `INSERT INTO coda_surveillance_revisions (discord_message_id, event_type, content, attachments)
         VALUES ($1, 'edit', '', '[]'::jsonb)`,
        [body.messageId],
      );
    }
    // Exact-message memories are invalid once their quoted source changes.
    await client.query(`DELETE FROM coda_surveillance_memories WHERE source_message_id = $1`, [body.messageId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recordDelete(pool: DatabasePool, body: SurveillanceEvent) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT 1 FROM coda_surveillance_messages WHERE discord_message_id = $1 FOR UPDATE`,
      [body.messageId],
    );

    // Discord deletion means deletion here too. Remove every stored revision so
    // deleted text cannot still be recovered from the admin history table.
    await client.query(`DELETE FROM coda_surveillance_revisions WHERE discord_message_id = $1`, [body.messageId]);
    await client.query(
      `INSERT INTO coda_surveillance_revisions (discord_message_id, event_type, content, attachments)
       VALUES ($1, 'delete', '', '[]'::jsonb)`,
      [body.messageId],
    );

    if (current.rowCount) {
      await client.query(
        `UPDATE coda_surveillance_messages
            SET content = '', attachments = '[]'::jsonb, deleted_at = NOW(), updated_at = NOW()
          WHERE discord_message_id = $1`,
        [body.messageId],
      );
    } else {
      await client.query(
        `INSERT INTO coda_surveillance_messages (
           discord_message_id, guild_id, channel_id, channel_name,
           author_id, author_name, author_username, author_bot,
           content, attachments, message_created_at, deleted_at, captured_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'','[]'::jsonb,$9,NOW(),NOW(),NOW())`,
        [
          body.messageId, body.guildId, body.channelId, body.channelName,
          body.authorId ?? '0', body.authorName, body.authorUsername, body.authorBot,
          body.createdAt ?? new Date().toISOString(),
        ],
      );
    }
    // A deleted Discord source must not survive inside a source-linked admin note.
    await client.query(`DELETE FROM coda_surveillance_memories WHERE source_message_id = $1`, [body.messageId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createCodaSurveillanceIngestRouter(config: AppConfig, pool: DatabasePool) {
  const router = Router();
  router.post('/', async (request, response, next) => {
    try {
      if (!config.CODA_INTERNAL_BRIDGE_SECRET) {
        return response.status(503).json({ error: 'Coda surveillance ingest is not configured.' });
      }
      if (!authorized(config, request.get('authorization'))) {
        return response.status(401).json({ error: 'Coda surveillance ingest authorization failed.' });
      }
      const body = surveillanceEventSchema.parse(request.body);
      if (body.event === 'create') await recordCreate(pool, body);
      else if (body.event === 'edit') await recordEdit(pool, body);
      else await recordDelete(pool, body);
      response.status(202).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

function numberQuery(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(max, Math.trunc(parsed))) : fallback;
}

export function createCodaSurveillanceAdminRouter(pool: DatabasePool) {
  const router = Router();

  router.get('/stats', async (_request, response, next) => {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*)::int AS total_messages,
          COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS active_messages,
          COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted_messages,
          MAX(captured_at) AS last_capture,
          (SELECT COUNT(*)::int FROM coda_surveillance_memories) AS memories
        FROM coda_surveillance_messages
      `);
      response.json({ stats: result.rows[0] ?? {} });
    } catch (error) { next(error); }
  });

  router.get('/messages', async (request, response, next) => {
    try {
      const limit = Math.max(1, numberQuery(request.query.limit, 50, 100));
      const offset = numberQuery(request.query.offset, 0, 100_000);
      const q = typeof request.query.q === 'string' ? request.query.q.trim() : '';
      const authorId = typeof request.query.authorId === 'string' ? request.query.authorId : '';
      const channelId = typeof request.query.channelId === 'string' ? request.query.channelId : '';
      const includeDeleted = request.query.includeDeleted === 'true';
      const params: unknown[] = [];
      const where: string[] = [];
      if (!includeDeleted) where.push('deleted_at IS NULL');
      if (q) {
        params.push(`%${q}%`);
        const p = `$${params.length}`;
        where.push(`(content ILIKE ${p} OR author_name ILIKE ${p} OR author_username ILIKE ${p} OR channel_name ILIKE ${p})`);
      }
      if (authorId) { params.push(authorId); where.push(`author_id = $${params.length}`); }
      if (channelId) { params.push(channelId); where.push(`channel_id = $${params.length}`); }
      params.push(limit, offset);
      const result = await pool.query(
        `SELECT discord_message_id AS "messageId", guild_id AS "guildId", channel_id AS "channelId",
                channel_name AS "channelName", author_id AS "authorId", author_name AS "authorName",
                author_username AS "authorUsername", author_bot AS "authorBot", content, attachments,
                reply_to_message_id AS "replyToMessageId", message_created_at AS "createdAt",
                edited_at AS "editedAt", deleted_at AS "deletedAt", captured_at AS "capturedAt"
           FROM coda_surveillance_messages
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY message_created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      response.json({ items: result.rows, limit, offset });
    } catch (error) { next(error); }
  });

  router.get('/messages/:id/revisions', async (request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT id::text, event_type AS "eventType", content, attachments, captured_at AS "capturedAt"
           FROM coda_surveillance_revisions
          WHERE discord_message_id = $1
          ORDER BY captured_at DESC`,
        [String(request.params.id)],
      );
      response.json({ items: result.rows });
    } catch (error) { next(error); }
  });

  router.get('/people', async (request, response, next) => {
    try {
      const days = Math.max(1, numberQuery(request.query.days, 30, 365));
      const result = await pool.query(
        `SELECT author_id AS "authorId", MAX(author_name) AS "authorName", MAX(author_username) AS "authorUsername",
                BOOL_OR(author_bot) AS "authorBot", COUNT(*)::int AS messages,
                MAX(message_created_at) AS "lastSeen"
           FROM coda_surveillance_messages
          WHERE message_created_at >= NOW() - ($1::int * INTERVAL '1 day')
          GROUP BY author_id
          ORDER BY messages DESC, "lastSeen" DESC`,
        [days],
      );
      response.json({ items: result.rows, days });
    } catch (error) { next(error); }
  });

  router.get('/channels', async (request, response, next) => {
    try {
      const days = Math.max(1, numberQuery(request.query.days, 30, 365));
      const result = await pool.query(
        `SELECT channel_id AS "channelId", MAX(channel_name) AS "channelName", COUNT(*)::int AS messages,
                COUNT(DISTINCT author_id)::int AS "activePeople", MAX(message_created_at) AS "lastMessageAt"
           FROM coda_surveillance_messages
          WHERE message_created_at >= NOW() - ($1::int * INTERVAL '1 day')
          GROUP BY channel_id
          ORDER BY messages DESC, "lastMessageAt" DESC`,
        [days],
      );
      response.json({ items: result.rows, days });
    } catch (error) { next(error); }
  });

  router.get('/memories', async (request, response, next) => {
    try {
      const guildId = typeof request.query.guildId === 'string' ? request.query.guildId : '';
      const q = typeof request.query.q === 'string' ? request.query.q.trim() : '';
      const params: unknown[] = [];
      const where: string[] = [];
      if (guildId) { params.push(guildId); where.push(`guild_id = $${params.length}`); }
      if (q) {
        params.push(`%${q}%`);
        const p = `$${params.length}`;
        where.push(`(title ILIKE ${p} OR content ILIKE ${p} OR tags::text ILIKE ${p})`);
      }
      const result = await pool.query(
        `SELECT id::text, guild_id AS "guildId", scope, subject_user_id AS "subjectUserId",
                channel_id AS "channelId", source_message_id AS "sourceMessageId", title, content, tags,
                importance, pinned, created_by_user_id::text AS "createdByUserId",
                created_at AS "createdAt", updated_at AS "updatedAt"
           FROM coda_surveillance_memories
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY pinned DESC, importance DESC, updated_at DESC
          LIMIT 250`,
        params,
      );
      response.json({ items: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/memories', async (request, response, next) => {
    try {
      const body = memoryCreateSchema.parse(request.body);
      const result = await pool.query(
        `INSERT INTO coda_surveillance_memories (
           guild_id, scope, subject_user_id, channel_id, source_message_id,
           title, content, tags, importance, pinned, created_by_user_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
         RETURNING id::text, guild_id AS "guildId", scope, subject_user_id AS "subjectUserId",
                   channel_id AS "channelId", source_message_id AS "sourceMessageId", title, content, tags,
                   importance, pinned, created_by_user_id::text AS "createdByUserId",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          body.guildId, body.scope, body.subjectUserId, body.channelId, body.sourceMessageId,
          body.title, body.content, JSON.stringify(body.tags), body.importance, body.pinned,
          request.session.userId ?? null,
        ],
      );
      response.status(201).json({ item: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.patch('/memories/:id', async (request, response, next) => {
    try {
      const body = memoryUpdateSchema.parse(request.body);
      const current = await pool.query(`SELECT * FROM coda_surveillance_memories WHERE id = $1`, [String(request.params.id)]);
      if (!current.rowCount) return response.status(404).json({ error: 'Memory not found.' });
      const row = current.rows[0] as Record<string, unknown>;
      const tags = body.tags ?? (Array.isArray(row.tags) ? row.tags : []);
      const result = await pool.query(
        `UPDATE coda_surveillance_memories SET
           scope = $2,
           subject_user_id = $3,
           channel_id = $4,
           source_message_id = $5,
           title = $6,
           content = $7,
           tags = $8::jsonb,
           importance = $9,
           pinned = $10,
           updated_at = NOW()
         WHERE id = $1
         RETURNING id::text, guild_id AS "guildId", scope, subject_user_id AS "subjectUserId",
                   channel_id AS "channelId", source_message_id AS "sourceMessageId", title, content, tags,
                   importance, pinned, created_by_user_id::text AS "createdByUserId",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [
          String(request.params.id),
          body.scope ?? row.scope,
          body.subjectUserId !== undefined ? body.subjectUserId : row.subject_user_id,
          body.channelId !== undefined ? body.channelId : row.channel_id,
          body.sourceMessageId !== undefined ? body.sourceMessageId : row.source_message_id,
          body.title ?? row.title,
          body.content ?? row.content,
          JSON.stringify(tags),
          body.importance ?? row.importance,
          body.pinned ?? row.pinned,
        ],
      );
      response.json({ item: result.rows[0] });
    } catch (error) { next(error); }
  });

  router.delete('/memories/:id', async (request, response, next) => {
    try {
      const result = await pool.query(`DELETE FROM coda_surveillance_memories WHERE id = $1`, [String(request.params.id)]);
      if (!result.rowCount) return response.status(404).json({ error: 'Memory not found.' });
      response.json({ ok: true });
    } catch (error) { next(error); }
  });

  return router;
}
