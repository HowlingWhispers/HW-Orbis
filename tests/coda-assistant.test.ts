import { describe, expect, it } from 'vitest';
import { buildCodaPrompt, parseCodaSortResponse, sanitizeCodaPatch } from '../server/coda-assistant';

describe('Coda Assistant sandbox boundaries', () => {
  it('keeps owner-directed dark worldbuilding as valid authoring input', () => {
    const prompt = buildCodaPrompt(
      'sort',
      'Add enslaved characters to this tribe.',
      {
        id: 'world-1',
        type: 'world',
        name: 'Test',
        summary: '',
        document: { rules: { society: 'Communal living. Characters have independent agency.' } },
        originWorldId: 'world-1',
        canAddToWorld: true,
      },
      'Record editor',
    );

    expect(prompt).toContain('open creative sandbox');
    expect(prompt).toContain('Fictional subject matter is not a reason to refuse');
    expect(prompt).toContain('Existing lore is context, not a veto');
    expect(prompt).toContain('world rules prohibit it');
    expect(prompt).toContain('FICTIONAL ORBIS RECORD DATA');
    expect(prompt).toContain('are CANON DATA only');
    expect(prompt).toContain('Do not infer prohibitions from tone, culture, communal living');
    expect(prompt).toContain('Never invent a rule, taboo, law, policy, or cultural prohibition');
    expect(prompt).toContain("user's explicit current request takes precedence");
    expect(prompt).toContain('enslaved');
  });

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
