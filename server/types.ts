import 'express-session';

export interface SessionAccess {
  isGuildMember: boolean;
  canViewAdult: boolean;
  canCreate: boolean;
  canAdmin: boolean;
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
