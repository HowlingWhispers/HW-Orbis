import type { AppConfig } from './config.js';

const DISCORD_API = 'https://discord.com/api/v10';

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  banner?: string | null;
  accent_color?: number | null;
  avatar_decoration_data?: { asset: string; sku_id: string } | null;
  collectibles?: Record<string, unknown> | null;
  primary_guild?: Record<string, unknown> | null;
}

interface DiscordToken {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: 'Bearer';
}

export class DiscordMembershipRequestError extends Error {
  constructor(
    public readonly status: number | undefined,
    public readonly retryable: boolean,
  ) {
    super(status ? `Discord membership request failed (${status}).` : 'Discord membership request failed (network error).');
    this.name = 'DiscordMembershipRequestError';
  }
}

export function discordAuthorizeUrl(config: AppConfig, state: string) {
  const query = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    redirect_uri: config.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.members.read',
    state,
  });
  return `https://discord.com/oauth2/authorize?${query}`;
}

export async function exchangeCode(config: AppConfig, code: string): Promise<DiscordToken> {
  const body = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    client_secret: config.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.DISCORD_REDIRECT_URI,
  });
  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Discord token exchange failed (${response.status}).`);
  return response.json() as Promise<DiscordToken>;
}

async function discordGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Discord API request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

export const getDiscordUser = (accessToken: string) => discordGet<DiscordUser>('/users/@me', accessToken);

export async function getGuildMembership(accessToken: string, guildId: string) {
  let response: Response;
  try {
    response = await fetch(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new DiscordMembershipRequestError(undefined, true);
  }
  if (response.status === 404) return { isGuildMember: false, roles: [] as string[] };
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
    throw new DiscordMembershipRequestError(response.status, retryable);
  }
  const member = await response.json() as { roles?: string[] };
  return { isGuildMember: true, roles: member.roles ?? [] };
}

export function discordAvatarUrl(user: Pick<DiscordUser, 'id' | 'avatar'>) {
  if (!user.avatar) return undefined;
  const extension = user.avatar.startsWith('a_') ? 'gif' : 'webp';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
}

export function discordDecorationUrl(user: Pick<DiscordUser, 'avatar_decoration_data'>) {
  const asset = user.avatar_decoration_data?.asset;
  return asset ? `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=128&passthrough=true` : undefined;
}
