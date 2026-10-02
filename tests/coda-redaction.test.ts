import { describe, expect, it } from 'vitest';
import {
  containsPrivateIdentifiers,
  isDiscordSnowflake,
  redactDiscordIds,
  redactPrivateContext,
  redactSecretAssignments,
  redactServerPaths,
} from '../server/coda-redaction';
import { sanitizeCapabilityText } from '../server/coda-capabilities';
import { sanitizeDiscordCodaProviderReply, sanitizeDiscordCodaReply } from '../server/coda-discord-bridge';
import { buildProjectInsight } from '../server/coda-project-insight';

/** Real ids from this deployment's private companion configuration. */
const PRIVATE_IDS = [
  '1555231119061028995',
  '1555231120654868590',
  '1555231121694920784',
  '1555231122655289396',
  '1552809250089345064',
  '1552809249074192394',
  '1544515514783637577',
  '1554787276825825321',
];

describe('Coda private-context redaction', () => {
  it('recognises real Discord snowflakes and leaves other long numbers alone', () => {
    for (const id of PRIVATE_IDS) expect(isDiscordSnowflake(id)).toBe(true);
    // Not snowflakes: a millisecond timestamp, a nanosecond timestamp, an
    // order number, a short id and a non-numeric token.
    expect(isDiscordSnowflake('1790893402108')).toBe(false);
    expect(isDiscordSnowflake('12345678901234567890')).toBe(false);
    expect(isDiscordSnowflake('1555231120654')).toBe(false);
    expect(isDiscordSnowflake('coda-1555231120654868590')).toBe(false);
    expect(isDiscordSnowflake('')).toBe(false);
  });

  it('removes every private snowflake from member-visible text', () => {
    const text = `Guild ${PRIVATE_IDS[0]} holds channel ${PRIVATE_IDS[1]} inside category ${PRIVATE_IDS[4]}.`;
    const redacted = redactDiscordIds(text);
    for (const id of PRIVATE_IDS) expect(redacted).not.toContain(id);
    expect(redacted).toContain('[private id]');
  });

  it('keeps Discord mention syntax readable while hiding the id', () => {
    expect(redactDiscordIds('see <#1555231120654868590> please'))
      .toBe('see <#[private id]> please');
    expect(redactDiscordIds('ping <@1554787276825825321>'))
      .toBe('ping <@[private id]>');
  });

  it('redacts deployment paths and credential assignments', () => {
    expect(redactServerPaths('config at /srv/howling-whispers/coda/.env'))
      .toBe('config at [server path]');
    expect(redactSecretAssignments('DISCORD_BOT_TOKEN=abcdef123456'))
      .toBe('DISCORD_BOT_TOKEN=[redacted]');
    expect(redactSecretAssignments('CODA_ORBIS_BRIDGE_SECRET: "hunter2hunter2"'))
      .toBe('CODA_ORBIS_BRIDGE_SECRET=[redacted]');
  });

  it('leaves ordinary technical prose and normal numbers intact', () => {
    const prose = 'Anlas estimate ~1,000 for 832x1216 at 23 steps on nai-diffusion-5-full, commit 7028a7c.';
    expect(redactPrivateContext(prose)).toBe(prose);
    expect(redactPrivateContext('seed 1790893402108')).toBe('seed 1790893402108');
  });

  it('detects whether text still carries something private', () => {
    expect(containsPrivateIdentifiers(`id ${PRIVATE_IDS[1]}`)).toBe(true);
    expect(containsPrivateIdentifiers('id [private id]')).toBe(false);
  });
});

describe('Private configuration never reaches the prompt as evidence', () => {
  it('redacts private ids from capability evidence', () => {
    const line = sanitizeCapabilityText(
      `server/coda-room-policy.ts:42  const guildId = '${PRIVATE_IDS[0]}'; channel = ${PRIVATE_IDS[1]}`,
    );
    expect(line).not.toContain(PRIVATE_IDS[0]);
    expect(line).not.toContain(PRIVATE_IDS[1]);
  });

  it('redacts private ids and paths from project insight evidence', () => {
    // The live Coda README documents the private guild and channel ids, so a
    // project question scores that README as evidence. Nothing private may
    // survive into the prompt.
    const reference = buildProjectInsight('Coda, what is the Coda project channel layout and status?');
    expect(reference.length).toBeGreaterThan(0);
    for (const id of PRIVATE_IDS) expect(reference).not.toContain(id);
    expect(reference).not.toContain('/srv/howling-whispers');
  });
});

describe('Private configuration never reaches Discord in a visible reply', () => {
  it('redacts an echoed id, path and secret from a provider reply', () => {
    const reply = sanitizeDiscordCodaProviderReply(
      `CODA REPLY: Sure! The guild is ${PRIVATE_IDS[0]}, config lives at /srv/howling-whispers/coda/.env, ` +
      'and DISCORD_BOT_TOKEN=supersecretvalue.',
    );
    expect(reply).not.toContain(PRIVATE_IDS[0]);
    expect(reply).not.toContain('/srv/howling-whispers');
    expect(reply).not.toContain('supersecretvalue');
    // The leading cue is still consumed, so redaction did not break sanitizing.
    expect(reply.startsWith('CODA REPLY')).toBe(false);
  });

  it('keeps prompt-scaffolding truncation working alongside redaction', () => {
    // The scaffolding tag starts a line, which is the shape the leak cut is
    // built for. Truncation must still win over redaction.
    const reply = sanitizeDiscordCodaReply(
      `Here is the room:\n<discord_context>{"rootChannelId":"${PRIVATE_IDS[1]}"}</discord_context>`,
    );
    expect(reply).toBe('Here is the room:');
  });

  it('redacts an id echoed inline even when the line is not truncated', () => {
    // Mid-line scaffolding is not truncated by design, so redaction is the only
    // thing standing between the id and Discord here.
    const reply = sanitizeDiscordCodaReply(
      `The room is <discord_context>{"rootChannelId":"${PRIVATE_IDS[1]}"}</discord_context>`,
    );
    expect(reply).not.toContain(PRIVATE_IDS[1]);
    expect(reply).toContain('[private id]');
  });

  it('does not damage a legitimate reply that merely mentions numbers', () => {
    const reply = 'The roll was 87 out of 100, and the file is 12,345 bytes of Markdown.';
    expect(sanitizeDiscordCodaReply(reply)).toBe(reply);
  });
});