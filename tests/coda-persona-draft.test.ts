import { describe, expect, it } from 'vitest';
import { unwrapDocumentPatch } from '../src/lib/coda-patch';

function mergeCodaDraft(current: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) return patch;
  if (!patch || typeof patch !== 'object') return patch;
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : {};
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    next[key] = mergeCodaDraft(base[key], value);
  }
  return next;
}

const blankPersonaDocument = {
  identity: { displayName: '', species: '', age: '', pronouns: '', description: '' },
  appearance: '',
  personality: '',
  background: '',
  speech: '',
  preferences: [],
  skills: [],
  notes: '',
  personaSettings: { visibility: 'private', showInLibrary: false, allowUse: false, allowForking: false },
};

// Exactly the shape the Coda request log recorded for a Persona file draft.
const wrappedDraft = {
  document: {
    identity: { age: 'pubescent teenager', description: 'A teenager experiencing the onset of puberty' },
    background: 'Recently entered puberty and is navigating the changes that come with it',
    personality: 'Curious about newly emerging feelings and desires',
  },
};

describe('Coda Persona draft unwrapping', () => {
  it('unwraps a document-wrapped draft so the visible Persona fields actually change', () => {
    const next = mergeCodaDraft(blankPersonaDocument, unwrapDocumentPatch(wrappedDraft)) as Record<string, never>;
    const identity = next.identity as unknown as Record<string, string>;

    expect(identity.age).toBe('pubescent teenager');
    expect(identity.description).toContain('onset of puberty');
    expect(next.background).toContain('Recently entered puberty');
    expect(next.personality).toContain('Curious about newly emerging feelings');
    // The bug's symptom: a nested second `document` and untouched fields.
    expect(next).not.toHaveProperty('document');
  });

  it('leaves a flat document-keyed draft untouched', () => {
    const flat = { identity: { age: '34' }, background: 'A dockworker' };
    expect(unwrapDocumentPatch(flat)).toEqual(flat);
  });

  it('does not unwrap when document is only one key among several', () => {
    const mixed = { document: { background: 'x' }, notes: 'y' };
    expect(unwrapDocumentPatch(mixed)).toEqual(mixed);
  });

  it('never unwraps non-object or a document key holding a non-object', () => {
    expect(unwrapDocumentPatch(null)).toBeNull();
    expect(unwrapDocumentPatch([1, 2])).toEqual([1, 2]);
    expect(unwrapDocumentPatch('text')).toBe('text');
    expect(unwrapDocumentPatch({ document: 'text' })).toEqual({ document: 'text' });
    expect(unwrapDocumentPatch({ document: ['a'] })).toEqual({ document: ['a'] });
  });

  it('preserves untouched Persona fields and sharing settings when applying', () => {
    const next = mergeCodaDraft(blankPersonaDocument, unwrapDocumentPatch(wrappedDraft)) as Record<string, unknown>;
    expect(next.speech).toBe('');
    expect(next.notes).toBe('');
    expect(next.preferences).toEqual([]);
    expect(next.personaSettings).toEqual(blankPersonaDocument.personaSettings);
  });
});
