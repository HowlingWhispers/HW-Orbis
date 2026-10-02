/**
 * Trusted adult-access resolution for the Coda Discord bridge.
 *
 * Why this cannot be a channel-name check
 * --------------------------------------
 * The 18+ boundary in Howling Whispers is a role boundary, not a channel
 * boundary. The adult Discord channel inherits `@everyone`, so any member can
 * post in it, and the channel itself carries no trustworthy signal about who is
 * allowed to *see* adult material. Any gate that inspects the channel name, the
 * category name, or the room the request arrived from is therefore decorative.
 *
 * The web application already resolves this correctly, but through a browser
 * session: `refreshSessionAccess` evaluates the member's Discord roles against
 * `adultRoleIds` and then ORs in the per-account `adult_access_override` grant.
 * A Discord bridge request has no session and no OAuth token, so it needs its
 * own server-authoritative path.
 *
 * Precedence, matching the session path exactly:
 *   1. `users.adult_access_override` - the operator grant. This is the only
 *      non-cached source and it is escalation-only, so it is read directly and
 *      applies before anything Discord can say.
 *   2. A live read of the member's Discord roles through the bot token, run
 *      through the same `decideAccess` used everywhere else.
 *
 * `users.can_view_adult` is deliberately NOT consulted. Migration 025 documents
 * why: it is a cache that the access middleware overwrites wholesale on every
 * evaluation, so reading it here would create a third, drift-prone source of
 * truth for a protected-content boundary.
 *
 * Every failure mode denies. An unreachable Discord, an unconfigured bot token,
 * a missing guild, or a member lookup that 404s all resolve to
 * `canViewAdult: false` with a reason, never to a guess.
 */

import { decideAccess } from './access.js';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';

const DISCORD_API = 'https://discord.com/api/v10';
type Fetch = typeof fetch;

export type CodaAdultAccessSource = 'override' | 'discord-role' | 'denied';

export interface CodaAdultAccessDecision {
  canViewAdult: boolean;
  source: CodaAdultAccessSource;
  /** Operator-facing explanation. Never returned to Discord. */
  reason: string;
}

export interface CodaAdultAccessInput {
  config: AppConfig;
  pool: DatabasePool;
  discordUserId: string;
  /** Trusted guild id from settings/config. Never a channel name. */
  guildId: string;
  adultRoleIds: readonly string[];
  fetchImpl?: Fetch;
  now?: () => number;
}

function deny(reason: string): CodaAdultAccessDecision {
  return { canViewAdult: false, source: 'denied', reason };
}

interface GuildMemberPayload {
  user?: { id?: string };
  roles?: string[];
}

async function readMemberRoles(
  config: AppConfig,
  guildId: string,
  discordUserId: string,
  fetchImpl: Fetch,
): Promise<{ ok: true; roles: string[] } | { ok: false; reason: string }> {
  if (!config.CODA_DISCORD_BOT_TOKEN) return { ok: false, reason: 'CODA_DISCORD_BOT_TOKEN is not configured on Orbis.' };
  if (!/^\d{17,20}$/.test(guildId)) return { ok: false, reason: 'No trusted guild id is configured for adult access checks.' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`, {
      headers: { Authorization: `Bot ${config.CODA_DISCORD_BOT_TOKEN}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 404) return { ok: false, reason: 'Discord reports the requester is not a member of the guild.' };
    if (!response.ok) return { ok: false, reason: `Discord role lookup failed with status ${response.status}.` };
    const payload = await response.json().catch(() => undefined) as GuildMemberPayload | undefined;
    const roles = Array.isArray(payload?.roles) ? payload.roles.filter((role): role is string => typeof role === 'string') : [];
    return { ok: true, roles };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return { ok: false, reason: aborted ? 'Discord role lookup timed out.' : 'Discord role lookup could not reach Discord.' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveCodaAdultAccess(input: CodaAdultAccessInput): Promise<CodaAdultAccessDecision> {
  const { config, pool, discordUserId, guildId, adultRoleIds, fetchImpl = fetch } = input;

  if (!adultRoleIds.length) {
    // An empty accepted-role list must deny rather than default to open, so a
    // removed role configuration cannot silently reopen adult content.
    return deny('No adult role is configured, so adult access is denied for everyone.');
  }

  const userResult = await pool.query(
    'SELECT id::text, discord_id, adult_access_override FROM users WHERE discord_id = $1 LIMIT 1',
    [discordUserId],
  );
  if (!userResult.rowCount) return deny('Discord account is not linked to an Orbis account.');
  const user = userResult.rows[0] as Record<string, unknown>;

  if (user.adult_access_override === true) {
    return { canViewAdult: true, source: 'override', reason: 'Per-account adult access override is set.' };
  }

  const roles = await readMemberRoles(config, guildId, discordUserId, fetchImpl);
  if (!roles.ok) return deny(roles.reason);

  const decision = decideAccess(true, roles.roles, {
    adultRoleIds: new Set(adultRoleIds),
    creatorRoleIds: new Set<string>(),
    adminRoleIds: new Set<string>(),
    bootstrapAdminRoleIds: new Set<string>(),
  });

  if (decision.canViewAdult) {
    return { canViewAdult: true, source: 'discord-role', reason: 'Discord role evaluation granted adult access.' };
  }
  return deny('The requester does not hold the configured adult role.');
}