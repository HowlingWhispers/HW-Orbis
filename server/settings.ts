import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';

export const settingKeys = {
  guildId: 'discord.guild_id',
  adultRoleIds: 'discord.adult_role_ids',
  creatorRoleIds: 'discord.creator_role_ids',
  adminRoleIds: 'discord.admin_role_ids',
  inviteUrl: 'discord.invite_url',
} as const;

const snowflake = z.string().regex(/^\d{17,20}$/, 'Use an exact Discord ID.');
const roleIds = z.array(snowflake).max(50).transform((ids) => [...new Set(ids)]);
const inviteUrl = z.string().trim().max(300).refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'discord.gg' || url.hostname === 'discord.com' || url.hostname === 'www.discord.com');
  } catch { return false; }
}, 'Use a valid HTTPS Discord invite URL.');

export const adminSettingsSchema = z.object({
  guildId: z.union([z.literal(''), snowflake]),
  adultRoleIds: roleIds,
  creatorRoleIds: roleIds,
  adminRoleIds: roleIds,
  inviteUrl,
}).superRefine((settings, context) => {
  const adult = new Set(settings.adultRoleIds);
  for (const creatorRoleId of settings.creatorRoleIds) {
    if (!adult.has(creatorRoleId)) context.addIssue({ code: 'custom', path: ['creatorRoleIds'], message: 'Every creator role must also be an Adult Access role.' });
  }
});

export type AdminSettingsInput = z.input<typeof adminSettingsSchema>;
export type OperationalSettings = z.output<typeof adminSettingsSchema>;

export interface EffectiveSettings extends OperationalSettings {
  effectiveCreatorRoleIds: string[];
  creatorUsesAdultFallback: boolean;
  bootstrapAdminRoleIds: string[];
  sources: Record<keyof OperationalSettings, 'database' | 'environment' | 'default'>;
}

export interface AuditEntry {
  id: string;
  settingKey: string;
  previousValue: unknown;
  newValue: unknown;
  changedByUserId: string | null;
  changedByName: string | null;
  changedAt: string;
}

export interface SettingsStore {
  getEffective(force?: boolean): Promise<EffectiveSettings>;
  update(actorUserId: string, settings: OperationalSettings): Promise<EffectiveSettings>;
  getAudit(limit?: number): Promise<AuditEntry[]>;
}

type StoredValues = Partial<Record<(typeof settingKeys)[keyof typeof settingKeys], unknown>>;

function environmentSettings(config: AppConfig): OperationalSettings {
  return {
    guildId: config.DISCORD_GUILD_ID,
    adultRoleIds: config.envAdultRoleIds,
    creatorRoleIds: config.envCreatorRoleIds,
    adminRoleIds: config.envAdminRoleIds,
    inviteUrl: config.envDiscordInviteUrl,
  };
}

export function resolveSettings(config: AppConfig, stored: StoredValues): EffectiveSettings {
  const environment = environmentSettings(config);
  const source = <K extends keyof OperationalSettings>(key: K, storedKey: (typeof settingKeys)[K]): OperationalSettings[K] => {
    if (Object.prototype.hasOwnProperty.call(stored, storedKey)) return stored[storedKey] as OperationalSettings[K];
    return environment[key];
  };
  const sources = Object.fromEntries((Object.keys(settingKeys) as Array<keyof OperationalSettings>).map((key) => {
    const storedKey = settingKeys[key];
    if (Object.prototype.hasOwnProperty.call(stored, storedKey)) return [key, 'database'];
    const value = environment[key];
    const configured = Array.isArray(value) ? value.length > 0 : Boolean(value);
    return [key, configured ? 'environment' : 'default'];
  })) as EffectiveSettings['sources'];

  const parsed = adminSettingsSchema.parse({
    guildId: source('guildId', settingKeys.guildId),
    adultRoleIds: source('adultRoleIds', settingKeys.adultRoleIds),
    creatorRoleIds: source('creatorRoleIds', settingKeys.creatorRoleIds),
    adminRoleIds: source('adminRoleIds', settingKeys.adminRoleIds),
    inviteUrl: source('inviteUrl', settingKeys.inviteUrl),
  });
  const creatorUsesAdultFallback = parsed.creatorRoleIds.length === 0;
  return {
    ...parsed,
    effectiveCreatorRoleIds: creatorUsesAdultFallback ? parsed.adultRoleIds : parsed.creatorRoleIds,
    creatorUsesAdultFallback,
    bootstrapAdminRoleIds: config.bootstrapAdminRoleIds,
    sources,
  };
}

async function readStored(client: Pick<DatabasePool, 'query'> | PoolClient): Promise<StoredValues> {
  const result = await client.query('SELECT setting_key, setting_value FROM app_settings');
  return Object.fromEntries(result.rows.map((row) => [row.setting_key, row.setting_value]));
}

export class PostgresSettingsStore implements SettingsStore {
  private cached?: { value: EffectiveSettings; expiresAt: number };
  constructor(private readonly pool: DatabasePool, private readonly config: AppConfig) {}

  async getEffective(force = false) {
    if (!force && this.cached && this.cached.expiresAt > Date.now()) return this.cached.value;
    const value = resolveSettings(this.config, await readStored(this.pool));
    this.cached = { value, expiresAt: Date.now() + 30_000 };
    return value;
  }

  async update(actorUserId: string, input: OperationalSettings) {
    const settings = adminSettingsSchema.parse(input);
    if (!this.config.DISCORD_GUILD_ID || this.config.bootstrapAdminRoleIds.length === 0) {
      throw new SettingsLockoutError('Configure DISCORD_GUILD_ID and at least one DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS recovery role on the server before changing administrative settings.');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const previousEffective = resolveSettings(this.config, await readStored(client));
      const pairs: Array<[string, unknown, unknown]> = [
        [settingKeys.guildId, previousEffective.guildId, settings.guildId],
        [settingKeys.adultRoleIds, previousEffective.adultRoleIds, settings.adultRoleIds],
        [settingKeys.creatorRoleIds, previousEffective.creatorRoleIds, settings.creatorRoleIds],
        [settingKeys.adminRoleIds, previousEffective.adminRoleIds, settings.adminRoleIds],
        [settingKeys.inviteUrl, previousEffective.inviteUrl, settings.inviteUrl],
      ];
      for (const [key, previousValue, newValue] of pairs) {
        if (JSON.stringify(previousValue) === JSON.stringify(newValue)) continue;
        await client.query(
          `INSERT INTO app_settings (setting_key, setting_value, updated_by_user_id)
           VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (setting_key) DO UPDATE SET setting_value=excluded.setting_value, updated_at=now(), updated_by_user_id=excluded.updated_by_user_id`,
          [key, JSON.stringify(newValue), actorUserId],
        );
        await client.query(
          `INSERT INTO admin_setting_audit (setting_key, previous_value, new_value, changed_by_user_id)
           VALUES ($1, $2::jsonb, $3::jsonb, $4)`,
          [key, JSON.stringify(previousValue), JSON.stringify(newValue), actorUserId],
        );
      }
      await client.query('COMMIT');
      this.cached = undefined;
      return this.getEffective(true);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAudit(limit = 30) {
    const result = await this.pool.query(
      `SELECT a.id::text, a.setting_key, a.previous_value, a.new_value, a.changed_by_user_id::text,
              u.display_name AS changed_by_name, a.changed_at
       FROM admin_setting_audit a LEFT JOIN users u ON u.id = a.changed_by_user_id
       ORDER BY a.changed_at DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows.map((row) => ({
      id: row.id, settingKey: row.setting_key, previousValue: row.previous_value, newValue: row.new_value,
      changedByUserId: row.changed_by_user_id, changedByName: row.changed_by_name,
      changedAt: new Date(row.changed_at).toISOString(),
    }));
  }
}

export class SettingsLockoutError extends Error {}
