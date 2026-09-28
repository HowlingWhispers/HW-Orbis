import type { DatabasePool } from './db.js';
import type { ProviderFailureClass } from './coda-provider-failures.js';

/**
 * Discord Coda shared-provider pool.
 *
 * Credential material is never stored or duplicated here. A member row points
 * at the existing `user_provider_settings` row, and the encrypted credential is
 * decrypted server-side only for the moment of a single provider request, then
 * dropped with the rest of the local scope. The public shape of this module
 * deliberately exposes no field that could carry a token.
 */

const migrationMissing = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';

export type PoolMember = {
  userId: string;
  model: string;
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
};

export type PoolPolicy = {
  /** Hard cap on provider attempts for one Coda request. Never fans out. */
  maxAttempts: number;
  entitlementCooldownMinutes: number;
  credentialCooldownMinutes: number;
  maxConsecutiveFailures: number;
};

/**
 * Cooldown grows with consecutive failures so a persistently bad member backs
 * off without being removed, and a member that keeps failing is disabled
 * outright. Both are reversible by re-enabling, so nothing requires a restart.
 */
function backoffMinutes(baseMinutes: number, consecutiveFailures: number) {
  const multiplier = 2 ** Math.max(0, Math.min(consecutiveFailures, 8));
  return Math.min(baseMinutes * multiplier, 24 * 60);
}

export async function readPoolParticipation(db: DatabasePool, userId: string) {
  try {
    const result = await db.query(
      `SELECT m.owner_opt_in, m.enabled, m.revoked_at, m.entitled, m.last_failure_class, m.consecutive_failures,
              (SELECT count(*) FROM coda_shared_key_allowed_users a WHERE a.owner_user_id = m.user_id)::int AS allowed_count
         FROM coda_shared_key_members m WHERE m.user_id = $1 AND m.provider = 'novelai'`,
      [userId],
    );
    const row = result.rows[0];
    return {
      // Consent plus at least one named account. An owner who has not named
      // anyone shares with nobody, even with the tick on.
      participating: Boolean(row?.owner_opt_in) && Boolean(row?.enabled) && !row?.revoked_at && Number(row?.allowed_count ?? 0) > 0,
      allowedCount: Number(row?.allowed_count ?? 0),
      available: true,
    };
  } catch (error) {
    // A rolling deploy without migration 024 must behave as "no pool", never as
    // an error on a Coda request.
    if (migrationMissing(error)) return { participating: false, allowedCount: 0, available: false };
    throw error;
  }
}

/** The Discord accounts an owner has named as trusted. */
export async function listAllowedDiscordUsers(db: DatabasePool, ownerUserId: string) {
  try {
    const result = await db.query(
      `SELECT discord_user_id, created_at FROM coda_shared_key_allowed_users
        WHERE owner_user_id = $1 ORDER BY created_at DESC`,
      [ownerUserId],
    );
    return {
      allowed: (result.rows as Array<Record<string, unknown>>).map((row) => ({
        discordId: String(row.discord_user_id),
        addedAt: String(row.created_at),
      })),
      available: true,
    };
  } catch (error) {
    if (migrationMissing(error)) return { allowed: [], available: false };
    throw error;
  }
}

export async function addAllowedDiscordUser(db: DatabasePool, ownerUserId: string, discordUserId: string) {
  try {
    await db.query(
      `INSERT INTO coda_shared_key_allowed_users (owner_user_id, discord_user_id) VALUES ($1, $2)
       ON CONFLICT (owner_user_id, discord_user_id) DO NOTHING`,
      [ownerUserId, discordUserId],
    );
    return { added: true };
  } catch (error) {
    if (migrationMissing(error)) return { added: false };
    throw error;
  }
}

export async function removeAllowedDiscordUser(db: DatabasePool, ownerUserId: string, discordUserId: string) {
  try {
    const result = await db.query(
      `DELETE FROM coda_shared_key_allowed_users WHERE owner_user_id = $1 AND discord_user_id = $2`,
      [ownerUserId, discordUserId],
    );
    return { removed: Boolean(result.rowCount) };
  } catch (error) {
    if (migrationMissing(error)) return { removed: false };
    throw error;
  }
}

/**
 * Record owner consent. Participation is always explicit: this is the only way
 * a member enters the pool, and revoking leaves the personal provider setting
 * completely untouched.
 */
export async function setPoolParticipation(db: DatabasePool, userId: string, participating: boolean) {
  const result = await db.query(
    `INSERT INTO coda_shared_key_members (user_id, provider, owner_opt_in, enabled, revoked_at, cooldown_until)
     VALUES ($1, 'novelai', $2, true, CASE WHEN $2 THEN NULL ELSE now() END, NULL)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       owner_opt_in = excluded.owner_opt_in,
       enabled = true,
       revoked_at = excluded.revoked_at,
       cooldown_until = NULL,
       consecutive_failures = 0,
       last_failure_class = NULL,
       updated_at = now()
     RETURNING owner_opt_in, revoked_at`,
    [userId, participating],
  );
  return { participating: Boolean(result.rows[0]?.owner_opt_in) && !result.rows[0]?.revoked_at };
}

/**
 * Least-recently-used selection.
 *
 * Deterministic and ordered in SQL rather than sampled, so rotation is fair and
 * auditable. `excludeUserId` prevents a member's own key from being handed back
 * to them through the pool after their personal attempt failed, which would
 * defeat the point of the fallback and double-charge one account.
 */
export async function selectPoolMembers(
  db: DatabasePool,
  model: string,
  policy: PoolPolicy,
  options: { excludeUserId?: string; requesterDiscordId?: string } = {},
): Promise<PoolMember[]> {
  const { excludeUserId, requesterDiscordId } = options;
  try {
    const result = await db.query(
      `SELECT m.user_id::text AS user_id, p.model, p.token_ciphertext, p.token_iv, p.token_tag
         FROM coda_shared_key_members m
         JOIN user_provider_settings p
           ON p.user_id = m.user_id AND p.provider = m.provider
        WHERE m.provider = 'novelai'
          AND m.owner_opt_in
          AND m.enabled
          AND m.revoked_at IS NULL
          AND m.entitled
          AND (m.cooldown_until IS NULL OR m.cooldown_until <= now())
          -- The member must be configured for the exact model Coda will ask
          -- for. Eligibility is never inferred from merely having a key.
          AND p.model = $1
          AND ($2::uuid IS NULL OR m.user_id <> $2::uuid)
          -- Scoped consent: this owner has to have named the requester. Consent
          -- is never a blanket yes, so an unlisted requester simply has no
          -- eligible member and gets the friendly unavailable reply.
          AND EXISTS (
            SELECT 1 FROM coda_shared_key_allowed_users a
             WHERE a.owner_user_id = m.user_id AND a.discord_user_id = $4::text
          )
        ORDER BY m.last_used_at ASC NULLS FIRST, m.id ASC
        LIMIT $3`,
      [model, excludeUserId ?? null, policy.maxAttempts, requesterDiscordId ?? null],
    );
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      userId: String(row.user_id),
      model: String(row.model),
      ciphertext: row.token_ciphertext as Buffer,
      iv: row.token_iv as Buffer,
      tag: row.token_tag as Buffer,
    }));
  } catch (error) {
    if (migrationMissing(error)) return [];
    throw error;
  }
}

export async function markPoolMemberUsed(db: DatabasePool, userId: string, model: string) {
  try {
    await db.query(
      `UPDATE coda_shared_key_members
          SET last_used_at = now(), entitled = true, entitled_model = $2,
              consecutive_failures = 0, last_failure_class = NULL, updated_at = now()
        WHERE user_id = $1 AND provider = 'novelai'`,
      [userId, model],
    );
  } catch (error) {
    if (migrationMissing(error)) return;
    throw error;
  }
}

/**
 * Apply health state after a failed attempt.
 *
 * An entitlement denial marks the member ineligible for this workload: a tier
 * does not change between requests, so continuing to try this member is pure
 * waste. An invalid credential does the same, and repeated credential failures
 * additionally disable the member. Rate limits and outages are *not* recorded
 * as ineligibility, because they say nothing about the member.
 */
export async function markPoolMemberFailed(
  db: DatabasePool,
  userId: string,
  model: string,
  failureClass: ProviderFailureClass,
  policy: PoolPolicy,
) {
  const permanent = failureClass === 'entitlement_denied' || failureClass === 'invalid_credential';
  const base = failureClass === 'entitlement_denied'
    ? policy.entitlementCooldownMinutes
    : policy.credentialCooldownMinutes;
  try {
    await db.query(
      `UPDATE coda_shared_key_members
          SET consecutive_failures = consecutive_failures + 1,
              last_failure_class = $3,
              entitled = CASE WHEN $4::boolean THEN false ELSE entitled END,
              entitled_model = CASE WHEN $4::boolean THEN $2 ELSE entitled_model END,
              cooldown_until = now() + make_interval(mins => LEAST($5::double precision, 1440)),
              enabled = CASE
                WHEN $4::boolean AND $3 = 'invalid_credential'
                 AND consecutive_failures + 1 >= $6::integer THEN false
                ELSE enabled
              END,
              updated_at = now()
        WHERE user_id = $1 AND provider = 'novelai'`,
      [userId, model, failureClass, permanent, backoffMinutes(base, 1), policy.maxConsecutiveFailures],
    );
  } catch (error) {
    if (migrationMissing(error)) return;
    throw error;
  }
}

/**
 * Fixed-window per-Discord-user limit. Durable, so a restart does not reset
 * everyone's allowance, and applied to guests more tightly than to members.
 */
export async function consumeRateLimit(
  db: DatabasePool,
  discordUserId: string,
  limit: number,
  windowSeconds: number,
) {
  try {
    const result = await db.query(
      `INSERT INTO coda_discord_rate_limits (discord_user_id, window_started_at, request_count)
       VALUES ($1, now(), 1)
       ON CONFLICT (discord_user_id) DO UPDATE SET
         request_count = CASE
           WHEN coda_discord_rate_limits.window_started_at < now() - make_interval(secs => $2::double precision)
             THEN 1
           ELSE coda_discord_rate_limits.request_count + 1
         END,
         window_started_at = CASE
           WHEN coda_discord_rate_limits.window_started_at < now() - make_interval(secs => $2::double precision)
             THEN now()
           ELSE coda_discord_rate_limits.window_started_at
         END,
         updated_at = now()
       RETURNING request_count`,
      [discordUserId, windowSeconds],
    );
    const count = Number(result.rows[0]?.request_count ?? 0);
    return { allowed: count <= limit, count, limit };
  } catch (error) {
    // A missing rate-limit table must not silence Coda; fail open rather than
    // deny every user during a rolling deploy.
    if (migrationMissing(error)) return { allowed: true, count: 0, limit };
    throw error;
  }
}
