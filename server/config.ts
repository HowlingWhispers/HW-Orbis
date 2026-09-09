import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8789),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  SESSION_COOKIE_NAME: z.string().min(1).default('orbis.sid'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_REDIRECT_URI: z.string().url(),
  DISCORD_GUILD_ID: z.string().regex(/^$|^\d{17,20}$/).default(''),
  DISCORD_ADULT_ROLE_IDS: z.string().default(''),
  DISCORD_CREATOR_ROLE_IDS: z.string().default(''),
  DISCORD_ADMIN_ROLE_IDS: z.string().default(''),
  DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS: z.string().default(''),
  DISCORD_INVITE_URL: z.string().default(''),
  VITE_DISCORD_INVITE_URL: z.string().default(''),
  ORBIS_VERSION: z.string().default('0.2.0'),
  ORBIS_BUILD_SHA: z.string().default(''),
  ORBIS_CREDENTIAL_ENCRYPTION_KEY: z.string().default(''),
  SPECULUS_BRIDGE_URL: z.string().url().default('http://127.0.0.1:8790'),
  SPECULUS_BRIDGE_SECRET: z.string().default(''),
  SPECULUS_LAUNCH_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(14_400),
});

export const parseRoleIds = (value: string) => [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))];

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(environment);
  return {
    ...env,
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
