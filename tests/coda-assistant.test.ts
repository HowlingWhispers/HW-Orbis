import { describe, expect, it } from 'vitest';
import { parseCodaSortResponse, sanitizeCodaPatch } from '../server/coda-assistant';

describe('Coda Assistant draft safety', () => {
  it('removes ownership, privacy and credential-shaped fields from record patches', () => {
    expect(sanitizeCodaPatch({
      identity: { name: 'Test World', description: 'A place.' },
      worldSettings: { visibility: 'public' },
      contentRating: 'adult',
      token: 'secret',
      nested: {
        permissions: { canAdmin: true },
        apiKey: 'hidden',
        useful: 'keep me',
      },
    })).toEqual({
      identity: { name: 'Test World', description: 'A place.' },
      nested: { useful: 'keep me' },
    });
  });

  it('parses a fenced structured draft and sanitizes the current-record patch', () => {
    const parsed = parseCodaSortResponse([
      '```json',
      '{',
      '  "summary": "Found one place.",',
      '  "proposals": [{"type":"place","name":"Hollow","confidence":"high","reason":"It is described as a settlement.","fields":{"description":"A quiet settlement."}}],',
      '  "questions": [],',
      '  "warnings": [],',
      '  "recordPatch": {"locations":[{"name":"Hollow","description":"A quiet settlement."}],"worldSettings":{"visibility":"public"}}',
      '}',
      '```',
    ].join('\n'));

    expect(parsed).toMatchObject({
      summary: 'Found one place.',
      proposals: [{ type: 'place', name: 'Hollow', confidence: 'high' }],
      recordPatch: {
        locations: [{ name: 'Hollow', description: 'A quiet settlement.' }],
      },
    });
  });

  it('rejects malformed or off-schema drafts instead of treating them as canon structure', () => {
    expect(parseCodaSortResponse('not json')).toBeUndefined();
    expect(parseCodaSortResponse('{"summary":"x","proposals":[{"type":"unknown","name":"x","confidence":"high"}]}')).toBeUndefined();
  });
});
