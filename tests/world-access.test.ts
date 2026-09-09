import { describe, expect, it } from 'vitest';
import { canDirectViewAssetRow, canDiscoverAssetRow, readWorldAccessSettings } from '../server/world-access.js';

describe('per-world access settings', () => {
  it('keeps existing worlds public when no settings exist', () => {
    expect(readWorldAccessSettings({})).toEqual({
      visibility: 'public',
      showInLibrary: true,
      allowForking: false,
    });
  });

  it('hides a private world and its children from everyone except its owner', () => {
    const world = {
      type: 'world',
      creator_user_id: 'owner',
      document: { worldSettings: { visibility: 'private', showInLibrary: false } },
    };
    const child = {
      type: 'place',
      creator_user_id: 'owner',
      origin_world_creator_user_id: 'owner',
      origin_world_document: world.document,
    };

    expect(canDirectViewAssetRow(world, 'owner')).toBe(true);
    expect(canDiscoverAssetRow(world, 'owner')).toBe(true);
    expect(canDirectViewAssetRow(world, 'someone-else')).toBe(false);
    expect(canDiscoverAssetRow(world, 'someone-else')).toBe(false);
    expect(canDirectViewAssetRow(child, 'someone-else')).toBe(false);
    expect(canDiscoverAssetRow(child, 'someone-else')).toBe(false);
  });

  it('allows an unlisted world by direct link but not in discovery', () => {
    const world = {
      type: 'world',
      creator_user_id: 'owner',
      document: { worldSettings: { visibility: 'unlisted', showInLibrary: false } },
    };
    expect(canDirectViewAssetRow(world, 'viewer')).toBe(true);
    expect(canDiscoverAssetRow(world, 'viewer')).toBe(false);
  });
});
