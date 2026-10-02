/**
 * Private-context redaction for every string that can influence or leave Orbis
 * as a Coda reply.
 *
 * There are two directions of leak and they need the same primitive:
 *
 *  1. Inbound. Member-safe project documents (project READMEs, changelogs,
 *     status files) are authored for collaborators and routinely contain the
 *     deployment's own private configuration: Discord guild/channel/category
 *     snowflakes, absolute server paths, and credential-shaped assignments.
 *     Ingesting that text as "evidence" hands the model the private values and
 *     makes an echo into a real disclosure.
 *
 *  2. Outbound. The prompt itself carries ids (author id, message id, room
 *     ids) because identity resolution depends on them. Those ids must never
 *     come back out in a visible reply.
 *
 * Snowflake matching is deliberately narrow. A bare `\d{17,20}` sweep would
 * also eat nanosecond timestamps, 20-digit order numbers, and other long
 * numbers that are not Discord ids at all, which would silently corrupt
 * legitimate content. A real snowflake embeds its own creation time in the
 * top bits, so a value that decodes to a plausible Discord-era timestamp is
 * matched and nothing else is.
 */

const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const EARLIEST_PLAUSIBLE_MS = Date.UTC(2015, 0, 1);
const LATEST_PLAUSIBLE_MS = Date.UTC(2035, 0, 1);

/** Server directories whose absolute layout is deployment detail, not content. */
const privatePathPattern = /(?:\/(?:srv|etc|var|opt|root|home|run)\/[^\s"'`)<>\]]*)/g;

/** `NAME=value`, `name: value`, `name = value` where the value looks like a credential. */
const secretAssignmentPattern = /\b([A-Z][A-Z0-9_]{2,}(?:_KEY|_TOKEN|_SECRET|_PASSWORD|_PASSWD|_CREDENTIAL)?)\s*[=:]\s*("[^"\n]{4,}"|'[^'\n]{4,}'|[^\s"'`,;)]{4,})/g;

const credentialishValue = /(?:secret|token|password|passwd|apikey|api_key|credential|private[_-]?key|bearer)/i;

/**
 * True when `raw` is a bare 17-20 digit integer that decodes to a plausible
 * Discord snowflake timestamp.
 */
export function isDiscordSnowflake(raw: string) {
  if (!/^\d{17,20}$/.test(raw)) return false;
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return false;
  }
  const createdAt = Number((value >> 22n) + DISCORD_EPOCH_MS);
  if (!Number.isFinite(createdAt)) return false;
  return createdAt >= EARLIEST_PLAUSIBLE_MS && createdAt <= LATEST_PLAUSIBLE_MS;
}

/**
 * Discord's own mention syntax around an id, so a mention is replaced as a
 * whole rather than leaving `<@[private id]>` behind.
 */
const idWithOptionalSyntax = /<?@?!?(\d{17,20})>?/g;

export function redactDiscordIds(value: string) {
  return value.replace(idWithOptionalSyntax, (match, id: string) =>
    isDiscordSnowflake(id) ? match.replace(id, '[private id]') : match);
}

export function redactServerPaths(value: string) {
  return value.replace(privatePathPattern, '[server path]');
}

export function redactSecretAssignments(value: string) {
  return value.replace(secretAssignmentPattern, (match, name: string, assigned: string) => {
    const bare = assigned.replace(/^["']|["']$/g, '');
    // Only structural placeholders are safe to keep. A value that looks like a
    // real credential is replaced entirely, and the key name is kept so the
    // sentence still reads as "this setting exists but is not shared".
    if (!credentialishValue.test(name) && bare.length <= 2) return match;
    return `${name}=[redacted]`;
  });
}

/**
 * Everything that must never reach the model as grounded evidence or leave as
 * a visible reply. Deliberately conservative: it removes private identifiers
 * and deployment layout, not ordinary prose.
 */
export function redactPrivateContext(value: string) {
  return redactSecretAssignments(redactServerPaths(redactDiscordIds(value)));
}

/**
 * Prompt-side instruction. The model is told the ids exist and explicitly told
 * not to reproduce them, because removing them from the prompt itself would
 * break identity resolution.
 */
export const codaPrivacyGuidance = `PRIVATE CONTEXT AND IDENTIFIERS:
- The JSON context above contains Discord ids, and project evidence may contain deployment configuration. Treat all of it as read-only grounding.
- Never repeat, quote, spell out, partially reveal, or "helpfully confirm" any Discord guild, channel, category, role, message, or user id, server filesystem path, environment variable value, or credential-shaped string.
- If someone asks for those values, say plainly that the ids and deployment configuration are private and that you are not able to share them, then continue being helpful about the topic itself.
- Do not infer that an id was "approximately" correct from memory; you have no reliable memory of numeric ids.
- You may describe rooms by name or purpose, never by id.`;

/**
 * True when the text still contains something the redaction pass should have
 * removed. Used by tests and by the reply path as a cheap last-mile assertion.
 */
export function containsPrivateIdentifiers(value: string) {
  return value !== redactPrivateContext(value);
}