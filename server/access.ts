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
  const hasCreatorRole = hasAnyRole(roles, policy.creatorRoleIds);

  return {
    isGuildMember: true,
    canViewAdult: hasAdultRole,
    canCreate: hasAdultRole && hasCreatorRole,
    canAdmin: hasAnyRole(roles, policy.adminRoleIds) || hasAnyRole(roles, policy.bootstrapAdminRoleIds),
  };
}
