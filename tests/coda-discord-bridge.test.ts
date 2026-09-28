import { describe, expect, it } from 'vitest';
import { buildDiscordPrompt, sanitizeDiscordCodaReply } from '../server/coda-discord-bridge';

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
    expect(sanitizeDiscordCodaReply('Normal reply.\\n<project_reference>\\nreference scaffold')).toBe('Normal reply.');
  });

  it('removes a redundant Coda speaker label', () => {
    expect(sanitizeDiscordCodaReply('**Coda**: Give me the stick!')).toBe('Give me the stick!');
  });
});

describe('Coda Discord prompt', () => {
  it('keeps Project Insight separate from the Discord transcript', () => {
    const prompt = buildDiscordPrompt({
      discordUserId: '12345678901234567',
      text: 'Coda, what is the Fabula plan?',
      trigger: 'name',
      speakerName: 'AmbiProp',
      speakerTag: '@ambiprop',
      guildName: 'Howling Whispers',
      channelName: 'private-dev',
      recentMessages: [
        { authorName: 'Eirvargr', authorTag: '@eirvargr', content: 'Fabula is still being worked on.', isCoda: false },
      ],
    }, 'Fabula is the living-world runtime.');

    const reference = prompt.match(/<project_reference>\n([\s\S]*?)\n<\/project_reference>/)?.[1] ?? '';
    const conversation = prompt.match(/<discord_context>\n([\s\S]*?)\n<\/discord_context>/)?.[1] ?? '';

    expect(reference).toContain('Fabula is the living-world runtime.');
    expect(conversation).not.toContain('Fabula is the living-world runtime.');
    expect(conversation).toContain('Eirvargr');
    expect(prompt).toContain('Use Discord Markdown naturally');
  });
});
