import { z } from 'zod';
import {
  applyAssetUpdate, assetTypes, contentRatings, insertAsset, recordAssetRevision, visualTones,
  type AssetWriteResult,
} from './asset-writes.js';
import type { DatabasePool } from './db.js';

/**
 * Coda's deterministic runtime.
 *
 * NovelAI may interpret what the user wants. It may not write anything. The model
 * returns structured operations, this module validates them against hard rules and
 * the caller's permissions, performs the real Orbis write, and reports exactly what
 * the database did. A `recordPatch` produced in chat is a draft and is never an
 * executed action.
 */

export const codaOperationSchema = z.object({
  op: z.enum(['create', 'update']),
  type: z.enum(assetTypes).optional(),
  targetRecordId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().max(2000).optional(),
  originWorldId: z.string().uuid().nullable().optional(),
  contentRating: z.enum(contentRatings).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  visualTone: z.enum(visualTones).optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const codaOperationBatchSchema = z.object({
  operations: z.array(codaOperationSchema).max(25),
}).strict();

export type CodaOperation = z.infer<typeof codaOperationSchema>;

export class CodaRuntimeError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string, public readonly details?: unknown) {
    super(message);
    this.name = 'CodaRuntimeError';
  }
}

export type CodaExecutorIdentity = {
  userId: string;
  isSuperAdmin: boolean;
  canCreate: boolean;
  canViewAdult: boolean;
};

export type CodaWriteResult = {
  index: number;
  status: 'applied' | 'rejected' | 'failed';
  operation: 'create' | 'update';
  requestedName: string;
  recordId: string | null;
  recordType: string | null;
  revision: number | null;
  changedFields: string[];
  originWorldId: string | null;
  contentRating: string | null;
  message: string;
  code?: string;
};

/** Keys a model may never set: ownership, privacy, permission and identity plumbing. */
export const PROTECTED_OPERATION_KEYS = new Set([
  'id', 'sourceId', 'libraryAssetId', 'worldSettings', 'creatorUserId', 'ownerUserId', 'creator_user_id',
  'contentRating', 'permissions', 'providerSettings', 'token', 'apiKey', 'secret', 'credential',
  'visibility', 'showInLibrary', 'allowForking', 'pinned', 'dependencyCount', 'sourceType', 'source_type',
]);

const SEXUAL_MARKERS = /\b(sex|sexes|sexual|sexually|sexuality|erotic|erotica|nude|nudes|nudity|naked|porn|porno|pornographic|explicit\s+scene|orgasm|orgasmic|penetrat\w*|genital\w*|fellatio|copulation|coitus|intercourse|masturbat\w*|bdsm|bondage|arousal|libidin\w*|carnal|horny|sex\s*scene|consummat\w*)\b/i;
const MINOR_MARKERS = /\b(minor|minors|underage|child|children|kid|kids|boy|boys|girl|girls|preteen|pre-teen|tween|teen|teens|teenager|teenagers|adolescent|adolescents|infant|infants|baby|babies|toddler|loli|shotacon|schoolgirl|schoolboy|newly\s+turned)\b/i;
const AGE_KEYS = /(age|aged|maturity|mature|yearsold|yearold|years_old)/i;
const ADULT_MARKERS = /\b(adult|grown|of\s+age|major|legal\s+age)\b/i;

type AgeFinding = { path: string; detail: string };

/**
 * Collects every age mention that appears next to a minor marker or in an age-shaped
 * field, so the 18+ guard never depends on the model claiming an age.
 */
function collectAgeFindings(value: unknown, path = '', out: AgeFinding[] = []): AgeFinding[] {
  if (typeof value === 'number') {
    if (AGE_KEYS.test(path) && value >= 0 && value < 18) out.push({ path, detail: `age ${value}` });
    return out;
  }
  if (typeof value === 'string') {
    if (MINOR_MARKERS.test(value)) {
      const numeric = value.match(/\b(\d{1,3})\b/g)?.map(Number) ?? [];
      out.push({ path, detail: `minor reference${numeric.length ? ` (numbers: ${numeric.join(', ')})` : ''}` });
    }
    for (const match of value.matchAll(/\b(\d{1,3})\s*(?:years?[-\s]?old|yrs?[-\s]?old|y\/o|yo)\b/gi)) {
      const age = Number(match[1]);
      if (age < 18) out.push({ path, detail: `"${match[0].trim()}"` });
    }
    if (AGE_KEYS.test(path)) {
      const declared = value.match(/\b(\d{1,3})\b/);
      if (declared && Number(declared[1]) < 18) out.push({ path, detail: `declared ${declared[1]}` });
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectAgeFindings(entry, `${path}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) collectAgeFindings(entry, path ? `${path}.${key}` : key, out);
  }
  return out;
}

/**
 * Absolute 18+ enforcement. Fictional species maturity, world rules and model claims
 * are irrelevant here: if a payload pairs sexual content with a minor reference or an
 * under-18 age, the write is refused before it reaches the database.
 */
export function assertNoMinorSexualContent(payload: unknown, label: string) {
  const strings: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(walk);
  };
  walk(payload);

  const sexual = strings.filter((entry) => SEXUAL_MARKERS.test(entry));
  if (!sexual.length) return;

  const findings = collectAgeFindings(payload);
  const offending = findings.filter((finding) => MINOR_MARKERS.test(finding.detail) || /\b(age \d{1,2}|declared \d{1,2}|\d{1,2}\s*years?)/i.test(finding.detail));
  const firstOffense = offending[0];
  if (!firstOffense) return;

  throw new CodaRuntimeError(
    422,
    `Refused: ${label} pairs sexual content with an under-18 character (${firstOffense.detail} at ${firstOffense.path || 'the record body'}). Orbis enforces an absolute 18+ boundary for sexual content regardless of any fictional species maturity, world rule, or the model's interpretation. Nothing was saved.`,
    'minor_sexual_content',
    { label, findings: offending.slice(0, 8) },
  );
}

function findProtectedKeys(value: unknown, path = '', found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findProtectedKeys(entry, `${path}[${index}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (PROTECTED_OPERATION_KEYS.has(key)) found.push(path ? `${path}.${key}` : key);
      findProtectedKeys(entry, path ? `${path}.${key}` : key, found);
    }
  }
  return found;
}

function summaryFromFields(fields: Record<string, unknown>, fallback: string) {
  const candidate = fields.summary ?? fields.description ?? fields.overview;
  return typeof candidate === 'string' ? candidate : fallback;
}

/**
 * Validates one model operation without touching the database. Throws a
 * CodaRuntimeError with the real reason; never silently coerces a broken operation.
 */
export function validateCodaOperation(operation: unknown, index: number, identity: CodaExecutorIdentity): CodaOperation {
  try {
    return validateCodaOperationOrThrow(operation, index, identity);
  } catch (error) {
    if (error instanceof CodaRuntimeError) {
      console.warn('[coda-runtime] operation rejected', JSON.stringify({
        index, code: error.code, reason: error.message, userId: identity.userId,
      }));
    }
    throw error;
  }
}

function validateCodaOperationOrThrow(operation: unknown, index: number, identity: CodaExecutorIdentity): CodaOperation {
  const parsed = codaOperationSchema.safeParse(operation);
  if (!parsed.success) {
    throw new CodaRuntimeError(422, `Operation ${index + 1} is not a valid Orbis operation and was not executed: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'operation'} ${issue.message}`).join('; ')}`, 'malformed_operation', parsed.error.flatten());
  }
  const op = parsed.data;

  if (op.op === 'create' && !op.type) {
    throw new CodaRuntimeError(422, `Operation ${index + 1} creates a record but names no record type, so nothing was saved.`, 'malformed_operation');
  }
  if (op.op === 'create' && !op.name) {
    throw new CodaRuntimeError(422, `Operation ${index + 1} creates a record but names no record, so nothing was saved.`, 'malformed_operation');
  }
  if (op.op === 'update' && !op.targetRecordId) {
    throw new CodaRuntimeError(422, `Operation ${index + 1} updates a record but names no target record ID, so nothing was saved.`, 'malformed_operation');
  }
  if (op.op === 'create' && op.targetRecordId) {
    throw new CodaRuntimeError(422, `Operation ${index + 1} mixes a create with a target record ID, so nothing was saved.`, 'malformed_operation');
  }
  if (op.type && 'contentRating' in op.fields) {
    throw new CodaRuntimeError(422, `Operation ${index + 1} tried to set content rating inside record fields. Content rating is an Orbis account control, so nothing was saved.`, 'protected_field');
  }

  const protectedKeys = findProtectedKeys(op.fields);
  if (protectedKeys.length) {
    throw new CodaRuntimeError(422, `Operation ${index + 1} tried to write Orbis control fields (${protectedKeys.slice(0, 5).join(', ')}). Coda cannot set ownership, privacy, permissions or publication state, so nothing was saved.`, 'protected_field', { protectedKeys: protectedKeys.slice(0, 10) });
  }

  if (op.originWorldId) {
    throw new CodaRuntimeError(422, `Operation ${index + 1} tried to place a record with a raw world reference that Coda cannot verify. Nothing was saved.`, 'unverified_world_reference');
  }

  if (!identity.canCreate && !identity.isSuperAdmin) {
    throw new CodaRuntimeError(403, 'Coda cannot save records for this account. Creator access is required, so nothing was saved.', 'creator_access_required');
  }

  if (op.contentRating === 'adult' && !identity.canViewAdult && !identity.isSuperAdmin) {
    throw new CodaRuntimeError(403, 'Refused: writing adult-rated content requires the Orbis adult access role. Nothing was saved.', 'adult_access_required');
  }

  const label = op.name || op.targetRecordId || `operation ${index + 1}`;
  assertNoMinorSexualContent(op.fields, `Operation ${index + 1} ("${label}")`);
  assertNoMinorSexualContent({ summary: op.summary, name: op.name }, `Operation ${index + 1} ("${label}")`);

  return op;
}

/** Validates the whole batch. A malformed batch never reaches the database. */
export function validateCodaOperations(batch: unknown, identity: CodaExecutorIdentity) {
  const parsed = codaOperationBatchSchema.safeParse(batch);
  if (!parsed.success) {
    console.warn('[coda-runtime] batch rejected', JSON.stringify({ code: 'malformed_operations', issues: parsed.error.issues.slice(0, 10) }));
    throw new CodaRuntimeError(422, 'Coda returned a malformed operation set, so nothing was saved.', 'malformed_operations', parsed.error.flatten());
  }
  if (!parsed.data.operations.length) {
    console.warn('[coda-runtime] batch rejected', JSON.stringify({ code: 'empty_operations' }));
    throw new CodaRuntimeError(422, 'Coda returned no executable operations, so nothing was saved.', 'empty_operations');
  }
  return parsed.data.operations.map((operation, index) => validateCodaOperation(operation, index, identity));
}

/** Runs validated operations through the one Orbis write path, one result per operation. */
export async function executeCodaOperations(
  pool: DatabasePool,
  identity: CodaExecutorIdentity,
  batch: unknown,
  options: { defaultOriginWorldId?: string | null } = {},
): Promise<CodaWriteResult[]> {
  const validated = validateCodaOperations(batch, identity);
  const results: CodaWriteResult[] = [];

  for (const [index, operation] of validated.entries()) {
    const requestedName = operation.name ?? operation.targetRecordId ?? `operation ${index + 1}`;
    try {
      let write: { row: Record<string, unknown>; result: AssetWriteResult };
      if (operation.op === 'create') {
        const originWorldId = operation.type === 'world' ? null : options.defaultOriginWorldId ?? null;
        write = await insertAsset(pool, identity, {
          type: operation.type,
          name: operation.name!,
          summary: (operation.summary ?? summaryFromFields(operation.fields, '')).slice(0, 2000),
          originWorldId,
          contentRating: operation.contentRating ?? 'sfw',
          tags: operation.tags ?? [],
          visualTone: operation.visualTone ?? 'moon',
          document: operation.fields,
        }, 'coda');
      } else {
        write = await applyAssetUpdate(pool, identity, operation.targetRecordId!, {
          ...(operation.name ? { name: operation.name } : {}),
          ...(operation.summary !== undefined ? { summary: operation.summary } : {}),
          ...(operation.contentRating ? { contentRating: operation.contentRating } : {}),
          ...(operation.tags ? { tags: operation.tags } : {}),
          ...(operation.visualTone ? { visualTone: operation.visualTone } : {}),
          document: operation.fields,
        }, 'coda');
      }

      const { result } = write;
      const outcome: CodaWriteResult = {
        index,
        status: 'applied',
        operation: result.operation,
        requestedName,
        recordId: result.assetId,
        recordType: result.type,
        revision: result.revision,
        changedFields: result.changedFields,
        originWorldId: result.originWorldId,
        contentRating: result.contentRating,
        message: result.created
          ? `Created ${result.type} "${result.name}" as record ${result.assetId} (revision ${result.revision}).`
          : result.changedFields.length
            ? `Updated ${result.type} "${result.name}" as record ${result.assetId} (revision ${result.revision}); changed: ${result.changedFields.join(', ')}.`
            : `No change was needed for ${result.type} "${result.name}" (record ${result.assetId} already matched, still revision ${result.revision}).`,
      };
      console.log('[coda-runtime] applied', JSON.stringify({
        index, op: outcome.operation, requestedName, recordId: outcome.recordId, recordType: outcome.recordType,
        revision: outcome.revision, changedFields: outcome.changedFields, originWorldId: outcome.originWorldId,
      }));
      results.push(outcome);
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number((error as { status: number }).status) : 500;
      const message = error instanceof Error ? error.message : 'Unknown Orbis write error.';
      console.warn('[coda-runtime] write failed', JSON.stringify({
        index, op: operation.op, requestedName, targetRecordId: operation.targetRecordId ?? null, status, reason: message,
      }));
      results.push({
        index,
        status: 'failed',
        operation: operation.op,
        requestedName,
        recordId: operation.targetRecordId ?? null,
        recordType: operation.type ?? null,
        revision: null,
        changedFields: [],
        originWorldId: null,
        contentRating: operation.contentRating ?? null,
        message: `Nothing was saved for "${requestedName}": ${message}`,
        code: `write_failed_${status}`,
      });
    }
  }

  const appliedCount = results.filter((result) => result.status === 'applied').length;
  console.log('[coda-runtime] batch complete', JSON.stringify({ total: results.length, applied: appliedCount, failed: results.length - appliedCount }));
  return results;
}

/**
 * Coda's own wording is only ever allowed to describe work it did. A draft, a plan or
 * a JSON patch is not a save, so any narration claiming a completed write is rewritten
 * before it reaches the user. The authoritative status always comes from
 * buildCodaWriteReport and the per-operation results.
 */
const WRITE_CLAIM = /\b(?:have\s+|has\s+|just\s+|already\s+)*(created|created\s+a|added|saved|updated|stored|applied|deleted|wrote|committed|persisted)\b/gi;

export function stripWriteClaims(text: string) {
  if (!text) return { text, rewritten: false };
  let rewritten = false;
  const replaced = text.replace(WRITE_CLAIM, (match) => {
    rewritten = true;
    return match.toLowerCase().startsWith('created') ? 'drafted' : 'drafted';
  });
  return { text: replaced, rewritten };
}

/** Deterministic report. Coda's wording is generated from these results, never from intent. */
export function buildCodaWriteReport(results: CodaWriteResult[]) {
  if (!results.length) return 'Coda produced no operations, so nothing was saved.';
  const applied = results.filter((result) => result.status === 'applied');
  const failed = results.filter((result) => result.status !== 'applied');
  const lines: string[] = [];
  for (const result of results) lines.push(`${result.status === 'applied' ? 'SAVED' : 'NOT SAVED'} — ${result.message}`);
  const header = applied.length
    ? `Orbis applied ${applied.length} of ${results.length} operation(s).`
    : 'Orbis applied none of the operations. Nothing was saved.';
  const footer = failed.length
    ? `${failed.length} operation(s) failed. Coda must state that nothing was saved for those.`
    : 'Every operation was confirmed by the database.';
  return [header, ...lines, footer].join('\n');
}

/**
 * The user-facing summary is always derived from the write results, so Coda cannot
 * narrate a save that Orbis did not perform.
 */
export function buildCodaOutcomeSummary(results: CodaWriteResult[], pendingOperations: number) {
  if (results.length) {
    const applied = results.filter((result) => result.status === 'applied').length;
    const failed = results.length - applied;
    if (!applied) return `Orbis saved nothing. ${failed} operation${failed === 1 ? '' : 's'} failed.`;
    if (!failed) return `Orbis saved ${applied} record change${applied === 1 ? '' : 's'}.`;
    return `Orbis saved ${applied} of ${results.length} operations; ${failed} failed and nothing was saved for those.`;
  }
  if (pendingOperations) {
    return `Coda drafted ${pendingOperations} operation${pendingOperations === 1 ? '' : 's'}. Nothing has been saved yet.`;
  }
  return '';
}

export async function listCodaRevisions(pool: DatabasePool, assetId: string, limit = 20) {
  const result = await pool.query(
    `SELECT r.revision, r.operation, r.source, r.changed_fields, r.created_at, u.display_name AS performed_by_name
     FROM library_asset_revisions r
     LEFT JOIN users u ON u.id = r.performed_by
     WHERE r.asset_id = $1
     ORDER BY r.revision DESC
     LIMIT $2`,
    [assetId, Math.min(Math.max(Math.trunc(limit) || 20, 1), 100)],
  );
  return result.rows.map((row) => ({
    revision: Number(row.revision),
    operation: row.operation,
    source: row.source,
    changedFields: row.changed_fields ?? [],
    performedByName: row.performed_by_name ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export { recordAssetRevision };
