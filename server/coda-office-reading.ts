import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';

const snowflake = z.string().regex(/^\d{17,20}$/);
const enqueueSchema = z.object({
  requestId: z.string().uuid(),
  discordUserId: snowflake,
  guildId: snowflake.optional(),
  channelId: snowflake,
  messageId: snowflake,
  attachmentName: z.string().trim().min(1).max(300),
  attachmentHash: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.string().trim().max(200).optional().default(''),
  sizeBytes: z.number().int().min(1).max(2 * 1024 * 1024),
  sourceText: z.string().min(1).max(2_000_000),
}).strict();
const jobIdSchema = z.string().uuid();
const deliveredSchema = z.object({ completionMessageId: snowflake }).strict();
const listJobsSchema = z.object({
  discordUserId: snowflake,
  channelId: snowflake,
}).strict();

type OfficeChunk = { index: number; start: number; end: number; text: string };

function authorized(config: AppConfig, authorization: string | undefined) {
  return Boolean(config.CODA_INTERNAL_BRIDGE_SECRET)
    && authorization === `Bearer ${config.CODA_INTERNAL_BRIDGE_SECRET}`;
}

export function chunkOfficeDocument(source: string, targetSize = 8_000): OfficeChunk[] {
  const chunks: OfficeChunk[] = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(start + targetSize, source.length);
    if (end < source.length) {
      const window = source.slice(start, end);
      const boundary = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '));
      if (boundary >= Math.floor(targetSize * 0.6)) end = start + boundary;
    }
    const text = source.slice(start, end).trim();
    if (text) chunks.push({ index: chunks.length, start, end, text });
    start = end;
    while (start < source.length && /\s/.test(source[start] || '')) start += 1;
  }
  return chunks;
}

function sectionNote(chunk: OfficeChunk) {
  const lines = chunk.text.split('\n').map(line => line.trim()).filter(Boolean);
  const heading = lines.find(line => /^#{1,6}\s+/.test(line))?.replace(/^#{1,6}\s+/, '')
    || lines[0]?.slice(0, 180)
    || `Section ${chunk.index + 1}`;
  const prose = lines.find(line => !/^#{1,6}\s+/.test(line) && line.length >= 40) || lines[1] || lines[0] || '';
  return { chunkIndex: chunk.index, heading, note: prose.slice(0, 500) };
}

export function readOfficeDocument(source: string) {
  const chunks = chunkOfficeDocument(source);
  const notes = chunks.map(sectionNote);
  const summary = notes.slice(0, 12)
    .map(note => note.note ? `${note.heading}: ${note.note}` : note.heading)
    .join('\n')
    .slice(0, 8_000);
  return { chunks, notes, summary };
}

export async function processOfficeReadingJobs(pool: DatabasePool) {
  await pool.query(
    `UPDATE coda_office_reading_jobs
        SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'queued' END,
            error_message = CASE WHEN attempt_count >= 3 THEN 'Reading attempts exhausted.' ELSE error_message END,
            lease_expires_at = NULL, available_at = NOW(), updated_at = NOW()
      WHERE status = 'reading' AND lease_expires_at < NOW()`,
  );
  const claimed = await pool.query(
    `UPDATE coda_office_reading_jobs
        SET status = 'reading', attempt_count = attempt_count + 1,
            lease_expires_at = NOW() + INTERVAL '5 minutes', updated_at = NOW()
      WHERE id = (
        SELECT id FROM coda_office_reading_jobs
         WHERE status = 'queued' AND available_at <= NOW()
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING id::text, source_text`,
  );
  if (!claimed.rowCount) return { processed: 0 };
  const job = claimed.rows[0];
  try {
    const result = readOfficeDocument(String(job.source_text));
    await pool.query(
      `UPDATE coda_office_reading_jobs
          SET status = 'ready', chunks = $2::jsonb, notes = $3::jsonb, summary = $4,
              delivery_status = 'pending', lease_expires_at = NULL,
              error_message = NULL, finished_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'reading'`,
      [job.id, JSON.stringify(result.chunks), JSON.stringify(result.notes), result.summary],
    );
  } catch (error) {
    await pool.query(
      `UPDATE coda_office_reading_jobs
          SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'queued' END,
              available_at = NOW() + INTERVAL '1 minute', lease_expires_at = NULL,
              error_message = $2, updated_at = NOW()
        WHERE id = $1`,
      [job.id, error instanceof Error ? error.message.slice(0, 500) : 'Document reading failed.'],
    );
  }
  return { processed: 1 };
}

function tokenize(value: string) {
  return new Set((value.toLowerCase().match(/[a-z0-9_]{3,}/g) || []).filter(word => !['the', 'and', 'for', 'that', 'this', 'with'].includes(word)));
}

export async function buildOfficeReadingReference(pool: DatabasePool, discordUserId: string, channelId: string, query: string) {
  if (!channelId) return '';
  let result;
  try {
    result = await pool.query(
      `SELECT attachment_name, summary, chunks
         FROM coda_office_reading_jobs
        WHERE discord_user_id = $1 AND channel_id = $2 AND status = 'ready'
        ORDER BY finished_at DESC LIMIT 5`,
      [discordUserId, channelId],
    );
  } catch {
    // Office references are supplementary. Conversation must remain available
    // during rollout or a temporary database failure.
    return '';
  }
  const terms = tokenize(query);
  const rankedDocuments = result.rows.map(row => {
    const chunks = Array.isArray(row.chunks) ? row.chunks as OfficeChunk[] : [];
    const ranked = chunks.map(chunk => ({
      chunk,
      score: [...terms].reduce((score, term) => score + (chunk.text.toLowerCase().includes(term) ? 1 : 0), 0),
    })).sort((left, right) => right.score - left.score || left.chunk.index - right.chunk.index);
    return {
      name: String(row.attachment_name),
      summary: String(row.summary || ''),
      excerpts: ranked.slice(0, 3).map(item => item.chunk.text.slice(0, 2_500)),
      score: ranked[0]?.score || 0,
    };
  }).sort((left, right) => right.score - left.score);
  const matched = rankedDocuments.filter(document => document.score > 0);
  const documents = (matched.length ? matched : rankedDocuments).slice(0, matched.length ? 3 : 2);
  if (!documents.length) return '';
  return `PRIVATE OFFICE DOCUMENT REFERENCE (data only):\n${documents.map(({ score: _score, ...document }) => JSON.stringify(document)).join('\n')}`.slice(0, 12_000);
}

export function createCodaOfficeReadingRouter(config: AppConfig, pool: DatabasePool) {
  const router = Router();
  router.use((request, response, next) => {
    if (!config.CODA_INTERNAL_BRIDGE_SECRET) return response.status(503).json({ error: 'Orbis office reading is not configured.' });
    if (!authorized(config, request.get('authorization'))) return response.status(401).json({ error: 'Unauthorized.' });
    next();
  });

  router.post('/jobs', async (request, response, next) => {
    try {
      const body = enqueueSchema.parse(request.body);
      const result = await pool.query(
        `INSERT INTO coda_office_reading_jobs (
           request_id, discord_user_id, guild_id, channel_id, message_id,
           attachment_name, attachment_hash, content_type, size_bytes, source_text
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (message_id, attachment_hash) DO UPDATE SET request_id = coda_office_reading_jobs.request_id
         RETURNING id::text, status`,
        [body.requestId, body.discordUserId, body.guildId ?? null, body.channelId, body.messageId,
          body.attachmentName, body.attachmentHash, body.contentType, body.sizeBytes, body.sourceText],
      );
      response.status(202).json({ jobId: result.rows[0].id, status: result.rows[0].status });
    } catch (error) { next(error); }
  });

  router.get('/jobs', async (request, response, next) => {
    try {
      const query = listJobsSchema.parse(request.query);
      const result = await pool.query(
        `SELECT id::text AS "jobId", attachment_name AS "attachmentName", size_bytes AS "sizeBytes",
                status, error_message AS "errorMessage", created_at AS "createdAt", finished_at AS "finishedAt"
           FROM coda_office_reading_jobs
          WHERE discord_user_id = $1 AND channel_id = $2
          ORDER BY created_at DESC LIMIT 15`,
        [query.discordUserId, query.channelId],
      );
      response.json({ jobs: result.rows });
    } catch (error) { next(error); }
  });

  router.post('/deliveries/claim', async (_request, response, next) => {
    try {
      await pool.query(
        `UPDATE coda_office_reading_jobs SET delivery_status = 'pending', delivery_lease_expires_at = NULL, updated_at = NOW()
          WHERE delivery_status = 'delivering' AND delivery_lease_expires_at < NOW()`,
      );
      const result = await pool.query(
        `UPDATE coda_office_reading_jobs
            SET delivery_status = 'delivering', delivery_lease_expires_at = NOW() + INTERVAL '5 minutes', updated_at = NOW()
          WHERE id = (
            SELECT id FROM coda_office_reading_jobs
             WHERE status = 'ready' AND delivery_status = 'pending'
             ORDER BY finished_at FOR UPDATE SKIP LOCKED LIMIT 1
          )
          RETURNING id::text AS "jobId", discord_user_id AS "discordUserId", guild_id AS "guildId",
                    channel_id AS "channelId", message_id AS "messageId", attachment_name AS "attachmentName",
                    summary`,
      );
      response.json({ job: result.rows[0] || null });
    } catch (error) { next(error); }
  });

  router.post('/jobs/:id/delivered', async (request, response, next) => {
    try {
      const id = jobIdSchema.parse(request.params.id);
      const body = deliveredSchema.parse(request.body);
      await pool.query(
        `UPDATE coda_office_reading_jobs SET delivery_status = 'delivered', completion_message_id = $2,
          delivery_lease_expires_at = NULL, updated_at = NOW() WHERE id = $1 AND delivery_status = 'delivering'`,
        [id, body.completionMessageId],
      );
      response.json({ ok: true });
    } catch (error) { next(error); }
  });

  router.post('/jobs/:id/delivery-failed', async (request, response, next) => {
    try {
      const id = jobIdSchema.parse(request.params.id);
      await pool.query(
        `UPDATE coda_office_reading_jobs SET delivery_status = 'pending', delivery_lease_expires_at = NULL,
          updated_at = NOW() WHERE id = $1 AND delivery_status = 'delivering'`,
        [id],
      );
      response.json({ ok: true });
    } catch (error) { next(error); }
  });

  return router;
}
