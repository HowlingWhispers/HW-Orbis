import { describe, expect, it } from 'vitest';
import { canDirectViewAssetRow, canDiscoverAssetRow, isAdultRestrictedAssetRow } from '../server/world-access.js';

const ownerId = 'f52fbc27-ba5a-49ca-8cb0-4aef90689fb2';
const otherOwnerId = '93f82c1a-00bf-46fb-85df-a58991c7609f';

const privateWorld = {
  type: 'world', creator_user_id: otherOwnerId,
  document: { worldSettings: { visibility: 'private', showInLibrary: false } },
};
const myPrivateWorld = {
  type: 'world', creator_user_id: ownerId,
  document: { worldSettings: { visibility: 'private', showInLibrary: false } },
};
const publicWorld = {
  type: 'world', creator_user_id: otherOwnerId,
  document: { worldSettings: { visibility: 'public', showInLibrary: true } },
};
const privateChild = {
  type: 'place', creator_user_id: otherOwnerId, origin_world_creator_user_id: otherOwnerId,
  origin_world_document: privateWorld.document,
};

describe('super-admin private-world recovery filter', () => {
  it('shows every world to a super-admin while the filter is off', () => {
    expect(canDiscoverAssetRow(privateWorld, ownerId, true, { hidePrivateUserWorlds: false })).toBe(true);
    expect(canDiscoverAssetRow(privateChild, ownerId, true, { hidePrivateUserWorlds: false })).toBe(true);
  });

  it('hides other users\u2019 private worlds from the admin list while the filter is on', () => {
    expect(canDiscoverAssetRow(privateWorld, ownerId, true, { hidePrivateUserWorlds: true })).toBe(false);
    expect(canDiscoverAssetRow(privateChild, ownerId, true, { hidePrivateUserWorlds: true })).toBe(false);
  });

  it('still shows the admin\u2019 own private worlds normally while the filter is on', () => {
    expect(canDiscoverAssetRow(myPrivateWorld, ownerId, true, { hidePrivateUserWorlds: true })).toBe(true);
  });

  it('keeps public worlds visible either way', () => {
    expect(canDiscoverAssetRow(publicWorld, ownerId, true, { hidePrivateUserWorlds: true })).toBe(true);
    expect(canDiscoverAssetRow(publicWorld, ownerId, true, { hidePrivateUserWorlds: false })).toBe(true);
  });

  it('never changes direct view, so a private world still opens by link with the filter on', () => {
    expect(canDirectViewAssetRow(privateWorld, ownerId, true)).toBe(true);
    expect(canDirectViewAssetRow(privateWorld, undefined, true)).toBe(true);
    // Direct view is the super-admin capability, not the browsing filter.
    expect(canDirectViewAssetRow(privateWorld, 'somebody-else')).toBe(false);
  });

  it('leaves ordinary members completely unaffected by the admin filter', () => {
    expect(canDiscoverAssetRow(privateWorld, otherOwnerId, false, { hidePrivateUserWorlds: true })).toBe(true);
    expect(canDiscoverAssetRow(privateWorld, ownerId, false, { hidePrivateUserWorlds: true })).toBe(false);
    expect(canDiscoverAssetRow(publicWorld, undefined, false, { hidePrivateUserWorlds: true })).toBe(true);
  });
});

describe('adult gating for record bytes', () => {
  const adult = { type: 'character', creator_user_id: otherOwnerId, content_rating: 'adult' };
  const sfw = { type: 'character', creator_user_id: otherOwnerId, content_rating: 'sfw' };

  it('restricts adult records from unverified viewers', () => {
    expect(isAdultRestrictedAssetRow(adult, ownerId, false)).toBe(true);
    expect(isAdultRestrictedAssetRow(adult, undefined, false)).toBe(true);
  });

  it('lets the owner and verified adult members through', () => {
    expect(isAdultRestrictedAssetRow(adult, otherOwnerId, false)).toBe(false);
    expect(isAdultRestrictedAssetRow(adult, ownerId, true)).toBe(false);
  });

  it('never restricts an SFW record', () => {
    expect(isAdultRestrictedAssetRow(sfw, undefined, false)).toBe(false);
  });
});
