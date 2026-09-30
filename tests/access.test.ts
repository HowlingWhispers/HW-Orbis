import { describe, expect, it } from 'vitest';
import { decideAccess } from '../server/access';

const policy = {
  adultRoleIds: new Set(['adult-role']),
  creatorRoleIds: new Set(['worldbuilding-role']),
  adminRoleIds: new Set(['admin-role']),
  bootstrapAdminRoleIds: new Set(['recovery-role']),
};

describe('Discord access policy', () => {
  it('never lets a non-member create', () => {
    expect(decideAccess(false, ['adult-role'], policy)).toEqual({ isGuildMember: false, canViewAdult: false, canCreate: false, canAdmin: false });
  });

  it('does not let an ordinary guild member create', () => {
    expect(decideAccess(true, ['ordinary-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: false, canAdmin: false });
  });

  it('does not let an adult-access role imply creation on its own', () => {
    expect(decideAccess(true, ['adult-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: true, canCreate: false, canAdmin: false });
  });

  it('allows creation only for the configured Worldbuilding role', () => {
    expect(decideAccess(true, ['worldbuilding-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: true, canAdmin: false });
  });

  it('keeps administration separate from adult viewing and creation', () => {
    expect(decideAccess(true, ['admin-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: false, canAdmin: true });
  });

  it('allows the protected bootstrap role to recover administration without creating', () => {
    expect(decideAccess(true, ['recovery-role'], policy)).toEqual({ isGuildMember: true, canViewAdult: false, canCreate: false, canAdmin: true });
  });

  it('denies creation when no creator roles are configured at all', () => {
    // An empty creator list must deny, not fall open, or removing the role
    // would silently reopen world creation for everyone.
    const unconfigured = { ...policy, creatorRoleIds: new Set<string>() };
    expect(decideAccess(true, ['ordinary-role', 'adult-role', 'admin-role'], unconfigured).canCreate).toBe(false);
  });
});
