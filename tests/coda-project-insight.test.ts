import { describe, expect, it } from 'vitest';
import { buildProjectInsight, isProjectInsightQuestion, listProjectInsightSources } from '../server/coda-project-insight';

describe('Coda Project Insight', () => {
  it('activates for project and recurring support questions without grounding ordinary banter', () => {
    expect(isProjectInsightQuestion('Coda, what is the Fabula project plan?')).toBe(true);
    expect(isProjectInsightQuestion('Coda, can I have more than one saved playthrough?')).toBe(true);
    expect(isProjectInsightQuestion('Coda, why is Adult greyed out for this Persona?')).toBe(true);
    expect(isProjectInsightQuestion('Coda, does Speculus have a mobile UI?')).toBe(true);
    expect(isProjectInsightQuestion('Coda, where is the Discord invite link?')).toBe(true);
    expect(isProjectInsightQuestion('Coda, do you like bacon?')).toBe(false);
  });

  it('grounds Fabula questions in the member-safe project knowledge file', () => {
    const reference = buildProjectInsight('Coda, what is the Fabula plan and is multiplayer part of it?');
    expect(reference).toContain('docs/CODA_PROJECT_KNOWLEDGE.md');
    expect(reference.toLowerCase()).toContain('fabula');
    expect(reference.toLowerCase()).toContain('multiplayer');
    expect(reference).not.toContain('DISCORD_BOT_TOKEN');
    expect(reference).not.toContain('CODA_INTERNAL_BRIDGE_SECRET');
  });

  it('reports the Orbis checkout as an available safe source', () => {
    const orbis = listProjectInsightSources().find((source) => source.id === 'orbis');
    expect(orbis?.available).toBe(true);
    expect(orbis?.documentCount).toBeGreaterThan(0);
  });
});
