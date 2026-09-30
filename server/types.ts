import 'express-session';

export interface SessionAccess {
  isGuildMember: boolean;
  canViewAdult: boolean;
  canCreate: boolean;
  canAdmin: boolean;
  /**
   * Set when adult viewing was granted by a super-admin override rather than by
   * a Discord role. The UI shows this so an operator can tell a granted account
   * apart from one that genuinely holds an Adult Access role.
   */
  adultAccessOverride?: boolean;
  checkedAt: number;
  verifiedAt?: number;
  membershipMissingAt?: number;
  retryAfter?: number;
}

declare module 'express-session' {
  interface SessionData {
    oauthState?: string;
    oauthReturnTo?: string;
    userId?: string;
    discordUserId?: string;
    discordAccessToken?: string;
    discordTokenExpiresAt?: number;
    access?: SessionAccess;
  }
}
