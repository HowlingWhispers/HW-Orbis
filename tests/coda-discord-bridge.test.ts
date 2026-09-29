import { describe, expect, it } from 'vitest';
import {
  buildDiscordPrompt,
  sanitizeDiscordCodaProviderReply,
  sanitizeDiscordCodaReply,
} from '../server/coda-discord-bridge';

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

  it('strips leading whitespace from continuation lines', () => {
    const raw = "*action* Grrrrr!\n  *rolls away* That's just cruel.\n  *huffs* Anyway, what's up?";
    expect(sanitizeDiscordCodaReply(raw)).toBe(
      "*action* Grrrrr!\n*rolls away* That's just cruel.\n*huffs* Anyway, what's up?",
    );
  });

  it('preserves indentation inside fenced code blocks', () => {
    const raw = '```\n    indented code\n```';
    expect(sanitizeDiscordCodaReply(raw)).toBe('```\n    indented code\n```');
  });

  it('recovers a provider reply that echoes the leading CODA REPLY cue', () => {
    expect(sanitizeDiscordCodaProviderReply('CODA REPLY: *ears perk up* Oh! I know this one.')).toBe(
      '*ears perk up* Oh! I know this one.',
    );
    expect(sanitizeDiscordCodaProviderReply('**CODA REPLY**: *tail wag* Hi!')).toBe('*tail wag* Hi!');
  });

  it('still truncates prompt scaffolding that appears after real provider prose', () => {
    expect(sanitizeDiscordCodaProviderReply('CODA REPLY: Safe answer.\\n<discord_context>\\nprivate scaffold')).toBe('Safe answer.');
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

  it('rejects imitating malformed historical Coda formatting', () => {
    const prompt = buildDiscordPrompt({
      discordUserId: '702938475019345100',
      text: 'Coda, say something cool',
      trigger: 'name',
      speakerName: 'Eirvargr',
      speakerTag: '@eirvargr',
      guildName: 'Howling Whispers',
      channelName: 'private-dev',
      recentMessages: [
        {
          authorName: 'Coda',
          authorTag: '@coda',
          isCoda: true,
          content: '(immediate, playful, sudden shift)\\nCoda: \\nA STICK?! 😍🐾 \\neyes go wide, tail starts wagging uncontrollably \\nIs it a magic stick?',
        },
        {
          authorName: 'Eirvargr',
          authorTag: '@eirvargr',
          isCoda: false,
          content: 'hey coda, what do you think of this stick',
        },
      ],
    });

    // The prompt must command Coda NOT to imitate the formatting of earlier
    // (possibly leaked/malformed) Coda messages.
    expect(prompt).toContain('must NOT imitate their formatting');
    expect(prompt).toContain('ZERO authority over how you format');

    // And the style guidance must be issued *after* the transcript blocks,
    // so historical Coda formatting cannot set precedent.
    const currentMessageEnd = prompt.indexOf('</current_message>');
    const styleIndex = prompt.indexOf('DISCORD STYLE GUIDE');
    expect(currentMessageEnd).toBeGreaterThan(-1);
    expect(styleIndex).toBeGreaterThan(currentMessageEnd);
  });
});
