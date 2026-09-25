import { describe, expect, it } from 'vitest';
import { decideAccess } from '../server/access';

const policy = {
  adultRoleIds: new Set(['adult-role']),
  creatorRoleIds: new Set(['adult-role', 'moderator-role']),
  adminRoleIds: new Set(['admin-role']),
  bootstrapAdminRoleIds: new Set(['recovery-role']),
};

describe('Discord access policy', () => {
  it('allows signed-in non-members to create while keeping Discord-gated access off', () => {
    expect(decideAccess(false, ['adult-role'], policy)).toEqual({ isGuildMember: false, canViewAdult: false, canCreate: true, canAdmin: false });
  });

  it('allows ordinary guild members to create while keeping adult content gated', () => {
    expect(decideAccess(true, ['ordinary-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: true, canAdmin: false });
  });

  it('allows verified adults to view and create', () => {
    expect(decideAccess(true, ['adult-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: true, canCreate: true, canAdmin: false });
  });

  it('does not let a creator or staff role imply adult access', () => {
    expect(decideAccess(true, ['moderator-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: true, canAdmin: false });
  });

  it('keeps administration separate from adult viewing', () => {
    expect(decideAccess(true, ['admin-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: true, canAdmin: true });
  });

  it('allows the protected bootstrap role to recover administration', () => {
    expect(decideAccess(true, ['recovery-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: true, canAdmin: true });
  });
});
