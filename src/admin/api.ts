export interface AdminSettings {
  guildId: string;
  adultRoleIds: string[];
  creatorRoleIds: string[];
  adminRoleIds: string[];
  inviteUrl: string;
  effectiveCreatorRoleIds: string[];
  creatorUsesAdultFallback: boolean;
  bootstrapAdminRoleIds: string[];
  sources: Record<'guildId' | 'adultRoleIds' | 'creatorRoleIds' | 'adminRoleIds' | 'inviteUrl', 'database' | 'environment' | 'default'>;
}

export interface AdminOverview {
  status: Record<'apiOnline' | 'databaseConnected' | 'discordOAuthConfigured' | 'discordGuildConfigured' | 'adultPolicyConfigured' | 'creatorPolicyConfigured' | 'adminPolicyConfigured' | 'inviteUrlConfigured', boolean>;
  secrets: Record<'databaseUrl' | 'sessionSecret' | 'discordClientSecret', 'configured' | 'missing'>;
  system: { version: string; buildSha: string | null; environment: string };
}

export interface AdminAuditEntry {
  id: string;
  settingKey: string;
  previousValue: unknown;
  newValue: unknown;
  changedByUserId: string | null;
  changedByName: string | null;
  changedAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    ...init, credentials: 'include',
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Orbis administration could not complete that request.');
  return data;
}

export const adminApi = {
  overview: () => request<AdminOverview>('/overview'),
  settings: () => request<{ settings: AdminSettings; roleResolution: { available: boolean; reason: string } }>('/settings'),
  audit: () => request<{ items: AdminAuditEntry[] }>('/audit'),
  updateSettings: (settings: Pick<AdminSettings, 'guildId' | 'adultRoleIds' | 'creatorRoleIds' | 'adminRoleIds' | 'inviteUrl'>) =>
    request<{ settings: AdminSettings }>('/settings', { method: 'PUT', body: JSON.stringify(settings) }),
};
