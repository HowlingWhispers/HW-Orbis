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

  it('uses species adulthood canon and avoids inventing extra systems', () => {
    const prompt = buildCodaPrompt(
      'sort',
      'Add fox captives aged 8 to 14. Foxes in this species are adults in that age range.',
      {
        id: 'world-1',
        type: 'world',
        name: 'Test',
        summary: '',
        document: { lore: { cultures: 'Communal tribe.' } },
        originWorldId: 'world-1',
        canAddToWorld: true,
      },
      'Record editor',
    );

    expect(prompt).toContain('Treat numeric age according to the fictional species');
    expect(prompt).toContain('explicitly says a species or character is adult');
    expect(prompt).toContain('Do not invent a different minimum age');
    expect(prompt).toContain('Do not invent a new faction, institution, legal code, rule system');
    expect(prompt).toContain('Do not rewrite world rules merely to "support"');
    expect(prompt).toContain('Do not add unrelated sexual, reproductive, consent');
    expect(prompt).toContain('Foxes in this species are adults in that age range.');
  });

  it('preserves parent, physical sub-race and spiritual-path distinctions in the sort contract', () => {
    const prompt = buildCodaPrompt(
      'sort',
      'Ponykind has Earth-Bound and Pegasus physical tribes, plus Unique Destiny and Clockwork spiritual paths. Make separate racial entries.',
      undefined,
      'Orbis home',
    );
    expect(prompt).toContain('Do not flatten a parent species');
    expect(prompt).toContain('physical sub-races/lineages');
    expect(prompt).toContain('spiritual paths');
    expect(prompt).toContain('fields.classification');
    expect(prompt).toContain('fields.parentSpeciesName');
    expect(prompt).toContain('Ponykind');
  });

  it('adds a strict recovery instruction for a malformed structured retry', () => {
    const prompt = buildCodaPrompt('sort', 'Make entries.', undefined, 'Orbis home', true);
    expect(prompt).toContain('RECOVERY RETRY');
    expect(prompt).toContain('did not pass strict JSON/schema validation');
    expect(prompt).toContain('Return one complete compact JSON object');
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
