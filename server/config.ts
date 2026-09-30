import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8789),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().min(1).default('orbis.sid'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  DISCORD_CLIENT_ID: z.string(),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_REDIRECT_URI: z.string().url(),
  DISCORD_GUILD_ID: z.string().regex(/^$|^\d{17,20}$/).default(''),
  CODA_DISCORD_BOT_TOKEN: z.string().default(''),
  CODA_DISCORD_CHANNEL_IDS: z.string().default(''),
  CODA_INTERNAL_BRIDGE_SECRET: z.string().default(''),
  // Discord Coda shared-provider pool. Both switches default to off: no shared
  // credential is ever used until an operator enables the pool, and guests are
  // refused until guest access is explicitly allowed.
  CODA_DISCORD_SHARED_POOL_ENABLED: z.enum(['true', 'false']).default('false'),
  CODA_DISCORD_GUEST_ACCESS: z.enum(['true', 'false']).default('false'),
  CODA_DISCORD_RATE_LIMIT: z.coerce.number().int().min(1).max(600).default(12),
  CODA_DISCORD_GUEST_RATE_LIMIT: z.coerce.number().int().min(1).max(600).default(4),
  CODA_DISCORD_RATE_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
  CODA_GITHUB_REMOTE_ENABLED: z.enum(['true', 'false']).default('false'),
  CODA_GITHUB_READ_TOKEN: z.string().default(''),
  CODA_GITHUB_ORG: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).default('HowlingWhispers'),
  CODA_GITHUB_REPOSITORIES: z.string().default('HW-Orbis,HW-Coda,HW-Speculus,HW-Fabula,HW-Landing,HW-Mouseion,HW-Studium'),
  CODA_WEATHER_DEFAULT_LOCATION: z.string().max(120).default(''),
  DISCORD_ADULT_ROLE_IDS: z.string().default(''),
  DISCORD_CREATOR_ROLE_IDS: z.string().default(''),
  DISCORD_ADMIN_ROLE_IDS: z.string().default(''),
  DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS: z.string().default(''),
  DISCORD_INVITE_URL: z.string().default(''),
  VITE_DISCORD_INVITE_URL: z.string().default(''),
  ORBIS_VERSION: z.string().default('0.2.0'),
  ORBIS_BUILD_SHA: z.string().default(''),
  ORBIS_CREDENTIAL_ENCRYPTION_KEY: z.string().default(''),
  // Local image uploads live on disk outside the repository. PostgreSQL stores
  // only the relative path and display metadata for each image.
  ORBIS_MEDIA_ROOT: z.string().min(1).default('/srv/howling-whispers/orbis-media'),
  SPECULUS_BRIDGE_URL: z.string().url().default('http://127.0.0.1:8790'),
  SPECULUS_BRIDGE_SECRET: z.string().default(''),
  SPECULUS_LAUNCH_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(14_400),
});

export const parseRoleIds = (value: string) => [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))];

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(environment);
  if (env.NODE_ENV === 'production') {
    if (!/^\d{17,20}$/.test(env.DISCORD_CLIENT_ID)) {
      throw new Error('Production requires a numeric Discord application client ID in DISCORD_CLIENT_ID.');
    }
    if (env.DISCORD_CLIENT_SECRET.length < 1) {
      throw new Error('Production requires a non-empty DISCORD_CLIENT_SECRET.');
    }
  }
  return {
    ...env,
    codaDiscordChannelIds: parseRoleIds(env.CODA_DISCORD_CHANNEL_IDS),
    codaSharedPoolEnabled: env.CODA_DISCORD_SHARED_POOL_ENABLED === 'true',
    codaDiscordGuestAccess: env.CODA_DISCORD_GUEST_ACCESS === 'true',
    codaGithubRemoteEnabled: env.CODA_GITHUB_REMOTE_ENABLED === 'true',
    codaGithubRepositories: parseRoleIds(env.CODA_GITHUB_REPOSITORIES),
    envAdultRoleIds: parseRoleIds(env.DISCORD_ADULT_ROLE_IDS),
    envCreatorRoleIds: parseRoleIds(env.DISCORD_CREATOR_ROLE_IDS),
    envAdminRoleIds: parseRoleIds(env.DISCORD_ADMIN_ROLE_IDS),
    bootstrapAdminRoleIds: parseRoleIds(env.DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS),
    envDiscordInviteUrl: env.DISCORD_INVITE_URL || env.VITE_DISCORD_INVITE_URL,
    isProduction: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY === 'true',
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
