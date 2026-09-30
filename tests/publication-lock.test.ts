import { describe, expect, it } from 'vitest';
import { assertPublicationNotWidened, normalizeWorldDocument, normalizePersonaDocument } from '../server/asset-writes';

function worldDoc(visibility?: unknown, showInLibrary?: unknown) {
  const settings: Record<string, unknown> = {};
  if (visibility !== undefined) settings.visibility = visibility;
  if (showInLibrary !== undefined) settings.showInLibrary = showInLibrary;
  return { worldSettings: settings };
}

function personaDoc(visibility?: unknown, showInLibrary?: unknown) {
  const settings: Record<string, unknown> = {};
  if (visibility !== undefined) settings.visibility = visibility;
  if (showInLibrary !== undefined) settings.showInLibrary = showInLibrary;
  return { personaSettings: settings };
}

describe('publication lock', () => {
  it('rejects making a private world public', () => {
    expect(() => assertPublicationNotWidened('world', worldDoc('private'), worldDoc('public'), false))
      .toThrow(/cannot be made public right now/);
  });

  it('rejects widening an unlisted world to public', () => {
    expect(() => assertPublicationNotWidened('world', worldDoc('unlisted'), worldDoc('public'), false))
      .toThrow(/cannot be made public right now/);
  });

  it('treats an unset world visibility as already public, so editing stays possible', () => {
    // canDirectViewAssetRow reads unset as public. Without this, re-saving an
    // already-public world would look like a new publication and the owner
    // would lose the ability to edit their own world.
    expect(() => assertPublicationNotWidened('world', worldDoc(), worldDoc('public'), false)).not.toThrow();
  });

  it('always allows making a record more private', () => {
    expect(() => assertPublicationNotWidened('world', worldDoc('public'), worldDoc('private'), false)).not.toThrow();
    expect(() => assertPublicationNotWidened('world', worldDoc('public'), worldDoc('unlisted'), false)).not.toThrow();
    expect(() => assertPublicationNotWidened('persona', personaDoc('public'), personaDoc('private'), false)).not.toThrow();
  });

  it('treats an unset Persona visibility as private and blocks publishing it', () => {
    expect(() => assertPublicationNotWidened('persona', personaDoc(), personaDoc('public'), false))
      .toThrow(/cannot be made public right now/);
  });

  it('lets super-admin publish for recovery and imports', () => {
    expect(() => assertPublicationNotWidened('world', worldDoc('private'), worldDoc('public'), true)).not.toThrow();
    expect(() => assertPublicationNotWidened('persona', personaDoc('private'), personaDoc('public'), true)).not.toThrow();
  });

  it('ignores asset types that carry no visibility block', () => {
    expect(() => assertPublicationNotWidened('place', worldDoc('private'), worldDoc('public'), false)).not.toThrow();
  });

  it('normalization still coerces unknown values to the safe default', () => {
    expect((normalizeWorldDocument(worldDoc('nonsense')).worldSettings as Record<string, unknown>).visibility).toBe('private');
    expect((normalizePersonaDocument(personaDoc('nonsense')).personaSettings as Record<string, unknown>).visibility).toBe('private');
  });

  it('cannot be widened by forcing showInLibrary alongside a non-public visibility', () => {
    const forged = normalizeWorldDocument(worldDoc('private', true));
    expect((forged.worldSettings as Record<string, unknown>).showInLibrary).toBe(false);
    expect(() => assertPublicationNotWidened('world', worldDoc('private'), forged, false)).not.toThrow();
  });
});
