import { describe, expect, it } from 'vitest';
import { parseCodaSortResponse } from '../server/coda-assistant';

const validBody = {
  summary: 'Drafting a Persona',
  intent: 'apply',
  operations: [],
  proposals: [],
  questions: [],
  warnings: [],
  recordPatch: {
    identity: { displayName: 'Maya', age: '14', species: 'Human' },
    appearance: 'She has chestnut hair.',
    personality: 'Curious.',
    background: 'A dockside archivist in training.',
    speech: 'Terse.',
    preferences: ['maps'],
    skills: ['sailing'],
    notes: '',
  },
};

describe('Coda structured output recovery', () => {
  it('parses a clean single object', () => {
    expect(parseCodaSortResponse(JSON.stringify(validBody))?.recordPatch).toEqual(validBody.recordPatch);
  });

  it('recovers the draft when the provider appends a second JSON object', () => {
    // Captured from a real failure: a complete object, then more content after it.
    // Slicing first "{" to last "}" spans both documents and rejects the whole reply.
    const reply = `${JSON.stringify(validBody)}\n${JSON.stringify({ note: 'trailing block' })}`;
    const parsed = parseCodaSortResponse(reply);
    expect(parsed?.recordPatch).toEqual(validBody.recordPatch);
    expect(parsed?.intent).toBe('apply');
  });

  it('recovers the draft when trailing prose follows the object', () => {
    const reply = `${JSON.stringify(validBody)}\n\nI hope that helps! Let me know if you want changes.`;
    expect(parseCodaSortResponse(reply)?.recordPatch).toEqual(validBody.recordPatch);
  });

  it('recovers the draft when a closing code fence trails the object', () => {
    expect(parseCodaSortResponse(`\`\`\`json\n${JSON.stringify(validBody)}\n\`\`\``)?.recordPatch).toEqual(validBody.recordPatch);
  });

  it('does not end an object early on a brace inside a string value', () => {
    const withBraces = { ...validBody, summary: 'uses {curly} braces and a "quoted" word' };
    const parsed = parseCodaSortResponse(JSON.stringify(withBraces));
    expect(parsed?.summary).toBe('uses {curly} braces and a "quoted" word');
    expect(parsed?.recordPatch).toEqual(validBody.recordPatch);
  });

  it('handles escaped backslashes and quotes inside values', () => {
    const gnarly = { ...validBody, summary: 'path C:\\\\temp and \\"escaped\\" text' };
    const parsed = parseCodaSortResponse(JSON.stringify(gnarly));
    expect(parsed?.summary).toBe('path C:\\\\temp and \\"escaped\\" text');
  });

  it('still refuses output with no JSON object at all', () => {
    expect(parseCodaSortResponse('I cannot help with that request.')).toBeUndefined();
    expect(parseCodaSortResponse('')).toBeUndefined();
  });

  it('still refuses valid JSON that violates the schema', () => {
    const badType = { ...validBody, intent: 'obliterate' };
    expect(parseCodaSortResponse(JSON.stringify(badType))).toBeUndefined();
  });
});
