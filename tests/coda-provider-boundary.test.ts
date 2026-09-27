import { describe, expect, it } from 'vitest';
import { buildCodaPrompt } from '../server/coda-assistant';
import { validateCodaOperation, type CodaExecutorIdentity } from '../server/coda-runtime';

const identity: CodaExecutorIdentity = {
  userId: 'user-1',
  isSuperAdmin: false,
  canCreate: true,
  canViewAdult: true,
};

describe('Coda provider boundary', () => {
  it('leaves content-policy decisions to the active provider instead of teaching Coda a second policy', () => {
    const prompt = buildCodaPrompt('sort', 'Create the record.');

    expect(prompt).toContain('The active AI provider governs generation/content-policy decisions.');
    expect(prompt).toContain('Coda does not add a second moral/content-review layer');
    expect(prompt).not.toContain('Hard limit: sexual content may never involve anyone under 18');
    expect(prompt).not.toContain('Sexual content involving anyone under 18 is refused by Orbis before it is written');
    expect(prompt).not.toContain('No fictional species maturity, world rule or in-fiction age makes it acceptable');
  });

  it('keeps fictional age classification species-aware instead of assuming human life stages', () => {
    const prompt = buildCodaPrompt('sort', 'This species reaches adulthood after six months.');

    expect(prompt).toContain('Do not interpret raw numeric age through human assumptions when the setting uses nonhuman species.');
    expect(prompt).toContain('Species-specific life stages and explicit authored adulthood definitions control the fictional classification.');
    expect(prompt).toContain('Treat numeric age according to the fictional species\' own canon for non-sexual classification');
  });

  it('accepts a one-year-old nonhuman record explicitly classified as adult for ordinary worldbuilding', () => {
    expect(() => validateCodaOperation({
      op: 'create',
      type: 'character',
      name: 'Short-Lived Adult',
      fields: {
        species: 'Mayfly Kin',
        chronologicalAge: 1,
        lifeStage: 'adult',
        speciesAdultAge: 0.5,
        occupation: 'harbour master',
      },
    }, 0, identity)).not.toThrow();
  });
});
