export interface DiscordAccessPolicy {
  adultRoleIds: ReadonlySet<string>;
  creatorRoleIds: ReadonlySet<string>;
  adminRoleIds: ReadonlySet<string>;
  bootstrapAdminRoleIds: ReadonlySet<string>;
}

export interface AccessDecision {
  isGuildMember: boolean;
  canViewAdult: boolean;
  canCreate: boolean;
  canAdmin: boolean;
}

const hasAnyRole = (roles: readonly string[], accepted: ReadonlySet<string>) => roles.some((role) => accepted.has(role));

export function decideAccess(isGuildMember: boolean, roles: readonly string[], policy: DiscordAccessPolicy): AccessDecision {
  if (!isGuildMember) return { isGuildMember: false, canViewAdult: false, canCreate: false, canAdmin: false };

  const hasAdultRole = hasAnyRole(roles, policy.adultRoleIds);
  // Worldbuilding is role-gated. An empty creator-role list denies creation
  // rather than defaulting to open, so removing the role cannot silently
  // reopen world creation for everyone.
  const hasCreatorRole = hasAnyRole(roles, policy.creatorRoleIds);
  return {
    isGuildMember: true,
    canViewAdult: hasAdultRole,
    canCreate: hasCreatorRole,
    canAdmin: hasAnyRole(roles, policy.adminRoleIds) || hasAnyRole(roles, policy.bootstrapAdminRoleIds),
  };
}
