import { describe, expect, it } from 'vitest';
import { sanitizeDiscordCodaReply } from '../server/coda-discord-bridge';

describe('Coda Discord reply sanitizer', () => {
  it('cleans the formatting leak seen in Discord', () => {
    const raw = '(immediate, playful, sudden shift from mock-offended to excited)\\nCoda: \\nA STICK?! 😍🐾 \\neyes go wide, tail starts wagging uncontrollably \\nIs it a magic stick?';
    expect(sanitizeDiscordCodaReply(raw)).toBe(
      'A STICK?! 😍🐾\neyes go wide, tail starts wagging uncontrollably\nIs it a magic stick?',
    );
  });

  it('keeps ordinary in-character parenthetical actions', () => {
    expect(sanitizeDiscordCodaReply('(gasps) A STICK?!')).toBe('(gasps) A STICK?!');
  });

  it('preserves literal escaped newlines inside fenced code', () => {
    const raw = 'Here you go:\\n```ts\\nconst sample = "a\\\\nb";\\n```';
    const cleaned = sanitizeDiscordCodaReply(raw);
    expect(cleaned.startsWith('Here you go:\n```ts')).toBe(true);
    expect(cleaned).toContain('"a\\\\nb"');
  });

  it('cuts off echoed prompt scaffolding', () => {
    expect(sanitizeDiscordCodaReply('Normal reply.\\n<discord_context>\\nsecret scaffold')).toBe('Normal reply.');
  });

  it('removes a redundant Coda speaker label', () => {
    expect(sanitizeDiscordCodaReply('**Coda**: Give me the stick!')).toBe('Give me the stick!');
  });
});
