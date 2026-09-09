import { describe, expect, it } from 'vitest';
import { decideAccess } from '../server/access';

const policy = {
  adultRoleIds: new Set(['adult-role']),
  creatorRoleIds: new Set(['adult-role', 'moderator-role']),
  adminRoleIds: new Set(['admin-role']),
  bootstrapAdminRoleIds: new Set(['recovery-role']),
};

describe('Discord access policy', () => {
  it('keeps non-members on SFW read-only access', () => {
    expect(decideAccess(false, ['adult-role'], policy)).toEqual({ isGuildMember: false, canViewAdult: false, canCreate: false, canAdmin: false });
  });

  it('keeps members without an accepted role on SFW read-only access', () => {
    expect(decideAccess(true, ['ordinary-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: false, canAdmin: false });
  });

  it('allows verified adults to view and create', () => {
    expect(decideAccess(true, ['adult-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: true, canCreate: true, canAdmin: false });
  });

  it('does not let a creator or staff role imply adult access', () => {
    expect(decideAccess(true, ['moderator-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: false, canAdmin: false });
  });

  it('keeps administration separate from adult viewing', () => {
    expect(decideAccess(true, ['admin-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: false, canAdmin: true });
  });

  it('allows the protected bootstrap role to recover administration', () => {
    expect(decideAccess(true, ['recovery-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: false, canAdmin: true });
  });
});
