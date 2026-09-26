import type { DatabasePool } from './db.js';
import type { CodaWriteResult } from './coda-runtime.js';

/**
 * Persistent per-user Coda debugging log.
 *
 * Every assistant request and every runtime execution is recorded against the Orbis
 * user who made the call, so a failure can be reconstructed later: what Coda was asked,
 * what operations she proposed, what the runtime refused, and what the database
 * actually wrote. Logging never throws into the request path and never stores provider
 * tokens, credentials or world text.
 */

export type CodaLogStatus = 'ok' | 'partial' | 'failed' | 'refused' | 'recovered';

export type CodaLogEntry = {
  requestId: string;
  channel: 'assistant' | 'execute';
  mode?: string | null;
  model?: string | null;
  pageHint?: string | null;
  assetId?: string | null;
  assetName?: string | null;
  intent?: string | null;
  applyOperations?: boolean;
  operationCount?: number;
  savedCount?: number;
  failedCount?: number;
  status: CodaLogStatus;
  durationMs?: number | null;
  inputChars?: number | null;
  operations?: unknown;
  writeResults?: CodaWriteResult[] | unknown;
  recordPatch?: unknown;
  message?: string | null;
};

export type CodaLogRecord = CodaLogEntry & {
  id: number;
  userId: string;
  userDisplayName: string | null;
  createdAt: string;
};

function safeJson(value: unknown, limit = 20_000) {
  try {
    const text = JSON.stringify(value ?? null);
    if (!text) return 'null';
    return text.length > limit ? JSON.stringify({ truncated: true, preview: text.slice(0, 400) }) : text;
  } catch {
    return 'null';
  }
}

/** Never let logging break a Coda request. Failures are swallowed and reported to stderr. */
export async function recordCodaLog(pool: DatabasePool, userId: string, entry: CodaLogEntry) {
  try {
    await pool.query(
      `INSERT INTO coda_request_logs
         (user_id, request_id, channel, mode, model, page_hint, asset_id, asset_name, intent, apply_operations,
          operation_count, saved_count, failed_count, status, duration_ms, input_chars, operations, write_results, record_patch, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20)`,
      [
        userId, entry.requestId, entry.channel, entry.mode ?? null, entry.model ?? null, entry.pageHint ?? null,
        entry.assetId ?? null, entry.assetName ?? null, entry.intent ?? null, entry.applyOperations ?? false,
        entry.operationCount ?? 0, entry.savedCount ?? 0, entry.failedCount ?? 0, entry.status,
        entry.durationMs ?? null, entry.inputChars ?? null,
        safeJson(entry.operations), safeJson(entry.writeResults), entry.recordPatch === undefined ? null : safeJson(entry.recordPatch),
        entry.message ? entry.message.slice(0, 2_000) : null,
      ],
    );
  } catch (error) {
    console.error('[coda-log] could not persist Coda log', error instanceof Error ? error.message : error);
  }
}

export async function listCodaLogs(pool: DatabasePool, options: { userId?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100) || 100, 1), 200);
  const result = await pool.query(
    `SELECT l.id, l.user_id, l.request_id, l.channel, l.mode, l.model, l.page_hint, l.asset_id, l.asset_name,
            l.intent, l.apply_operations, l.operation_count, l.saved_count, l.failed_count, l.status,
            l.duration_ms, l.input_chars, l.operations, l.write_results, l.record_patch, l.message, l.created_at,
            u.display_name AS user_display_name
     FROM coda_request_logs l
     LEFT JOIN users u ON u.id = l.user_id
     ${options.userId ? 'WHERE l.user_id = $2' : ''}
     ORDER BY l.created_at DESC
     LIMIT $1`,
    options.userId ? [limit, options.userId] : [limit],
  );

  return result.rows.map<CodaLogRecord>((row) => ({
    id: Number(row.id),
    userId: row.user_id,
    userDisplayName: row.user_display_name ?? null,
    requestId: row.request_id,
    channel: row.channel,
    mode: row.mode,
    model: row.model,
    pageHint: row.page_hint,
    assetId: row.asset_id,
    assetName: row.asset_name,
    intent: row.intent,
    applyOperations: row.apply_operations,
    operationCount: row.operation_count,
    savedCount: row.saved_count,
    failedCount: row.failed_count,
    status: row.status,
    durationMs: row.duration_ms,
    inputChars: row.input_chars,
    operations: row.operations ?? [],
    writeResults: row.write_results ?? [],
    recordPatch: row.record_patch,
    message: row.message,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function listCodaLogUsers(pool: DatabasePool) {
  const result = await pool.query(
    `SELECT l.user_id, u.display_name, count(*)::int AS entries, max(l.created_at) AS last_seen
     FROM coda_request_logs l
     LEFT JOIN users u ON u.id = l.user_id
     GROUP BY l.user_id, u.display_name
     ORDER BY max(l.created_at) DESC`,
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name ?? 'Unknown user',
    entries: row.entries,
    lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
  }));
}
