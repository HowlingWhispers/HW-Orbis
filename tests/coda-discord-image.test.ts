import { describe, expect, it } from 'vitest';
import { buildCodaImagePrompt } from '../server/coda-discord-image';

describe('Coda Discord image prompt', () => {
  it('keeps Coda identity in prose while letting the scene control the moment', () => {
    const prompt = buildCodaImagePrompt('holding a clipboard and glaring at hair clippers', 2);
    expect(prompt).toContain('adult female anthropomorphic canine beastfolk');
    expect(prompt).toContain('Malamute-inspired appearance');
    expect(prompt).toContain('bright saturated blue eyes');
    expect(prompt).toContain('Scene direction: holding a clipboard and glaring at hair clippers');
    expect(prompt).toContain('Do not copy a previous Coda pose');
    expect(prompt).toContain('Do not default to both paws raised beside the chest');
  });

  it('uses different composition directions without changing identity', () => {
    const first = buildCodaImagePrompt('reading a book', 0);
    const second = buildCodaImagePrompt('reading a book', 7);
    expect(first).not.toBe(second);
    expect(first).toContain('Coda remains the sole character');
    expect(second).toContain('Coda remains the sole character');
    expect(first).toContain('cyan, aqua and pale blue');
    expect(second).toContain('cyan, aqua and pale blue');
  });
});
