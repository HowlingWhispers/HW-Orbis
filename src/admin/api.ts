import { CODA_MESSAGE_MAX_LENGTH } from './codaMessage';

export { CODA_MESSAGE_MAX_LENGTH };

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
  status: Record<'apiOnline' | 'databaseConnected' | 'discordOAuthConfigured' | 'discordGuildConfigured' | 'adultPolicyConfigured' | 'creatorPolicyConfigured' | 'adminPolicyConfigured' | 'inviteUrlConfigured' | 'codaDiscordConfigured', boolean>;
  secrets: Record<'databaseUrl' | 'sessionSecret' | 'discordClientSecret' | 'codaDiscordBotToken', 'configured' | 'missing'>;
  system: { version: string; buildSha: string | null; environment: string };
}

export interface AdminCodaChannel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  parentName: string | null;
  position: number;
  allowlisted: boolean;
}

export interface AdminCodaChannelState {
  configured: boolean;
  guildId: string;
  items: AdminCodaChannel[];
  reason?: string;
}

export interface AdminCodaMember {
  id: string;
  username: string;
  displayName: string;
  bot: boolean;
}

export interface AdminCodaMessage {
  id: string;
  auditId?: string | null;
  guildId: string;
  channelId: string;
  discordMessageId: string | null;
  destinationType: 'channel' | 'dm';
  recipientUserId: string | null;
  recipientDisplayName: string | null;
  content: string;
  replyToMessageId: string | null;
  status: 'sent' | 'failed';
  errorMessage: string | null;
  sentByUserId: string | null;
  sentByName: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface AdminCodaTemplate {
  id: string;
  name: string;
  content: string;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCodaScheduled {
  id: string;
  destinationType: 'channel' | 'dm';
  targetId: string;
  content: string;
  replyTo: string;
  sendAt: string;
  status: 'queued' | 'sending' | 'sent' | 'cancelled' | 'failed';
  lastError: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCodaLogUser {
  userId: string;
  displayName: string;
  entries: number;
  lastSeen: string | null;
}

export interface AdminCodaLog {
  id: number;
  userId: string;
  userDisplayName: string | null;
  requestId: string;
  channel: 'assistant' | 'execute';
  mode: string | null;
  model: string | null;
  pageHint: string | null;
  assetId: string | null;
  assetName: string | null;
  intent: string | null;
  applyOperations: boolean;
  operationCount: number;
  savedCount: number;
  failedCount: number;
  status: 'ok' | 'partial' | 'failed' | 'refused' | 'recovered';
  durationMs: number | null;
  inputChars: number | null;
  operations: unknown;
  writeResults: unknown;
  recordPatch: unknown;
  message: string | null;
  createdAt: string;
}

export interface AdminCodaStatus {
  configured: boolean;
  outboundEnabled: boolean;
  splitLongMessages: boolean;
  maxMessageLength: number;
  maxComposedLength: number;
  allowedChannelCount: number;
  postableChannelCount: number;
  queuedScheduled: number;
  lastMessageAt: string | null;
  bot: { id: string; username: string; globalName: string | null } | null;
  guild: { id: string; name: string } | null;
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
  codaChannels: () => request<AdminCodaChannelState>('/coda/channels'),
  codaMessages: (limit = 50) => request<{ items: AdminCodaMessage[] }>('/coda/messages?limit=' + encodeURIComponent(String(limit))),
  sendCodaMessage: (input: { channelId: string; content: string; replyTo?: string }) =>
    request<{ message: AdminCodaMessage; messages: AdminCodaMessage[]; partCount: number }>('/coda/messages', { method: 'POST', body: JSON.stringify(input) }),
  editCodaMessage: (id: string, content: string) => request<{ ok: boolean }>('/coda/messages/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ content }) }),
  deleteCodaMessage: (id: string) => request<{ ok: boolean }>('/coda/messages/' + encodeURIComponent(id), { method: 'DELETE' }),
  codaMembers: (query: string) => request<{ items: AdminCodaMember[] }>('/coda/members?query=' + encodeURIComponent(query)),
  sendCodaDm: (input: { recipient: string; content: string }) =>
    request<{ message: AdminCodaMessage; messages: AdminCodaMessage[]; partCount: number }>('/coda/dms', { method: 'POST', body: JSON.stringify(input) }),
  codaTemplates: () => request<{ items: AdminCodaTemplate[] }>('/coda/templates'),
  createCodaTemplate: (input: { name: string; content: string }) =>
    request<{ item: AdminCodaTemplate }>('/coda/templates', { method: 'POST', body: JSON.stringify(input) }),
  deleteCodaTemplate: (id: string) => request<{ ok: boolean }>('/coda/templates/' + encodeURIComponent(id), { method: 'DELETE' }),
  codaScheduled: () => request<{ items: AdminCodaScheduled[] }>('/coda/scheduled'),
  scheduleCodaMessage: (input: { destinationType: 'channel' | 'dm'; targetId: string; content: string; replyTo?: string; sendAt: string }) =>
    request<{ item: AdminCodaScheduled }>('/coda/scheduled', { method: 'POST', body: JSON.stringify(input) }),
  cancelCodaScheduled: (id: string) => request<{ ok: boolean }>('/coda/scheduled/' + encodeURIComponent(id), { method: 'DELETE' }),
  codaLogs: (userId?: string, limit = 100) =>
    request<{ items: AdminCodaLog[]; users: AdminCodaLogUser[] }>('/coda/logs?limit=' + encodeURIComponent(String(limit)) + (userId ? '&userId=' + encodeURIComponent(userId) : '')),
  codaStatus: () => request<AdminCodaStatus>('/coda/status'),
  setCodaOutbound: (outboundEnabled: boolean, splitLongMessages?: boolean) =>
    request<{ outboundEnabled: boolean; splitLongMessages: boolean; updatedAt: string; updatedByUserId: string | null }>('/coda/control', {
      method: 'PUT',
      body: JSON.stringify(splitLongMessages === undefined ? { outboundEnabled } : { outboundEnabled, splitLongMessages }),
    }),
  updateSettings: (settings: Pick<AdminSettings, 'guildId' | 'adultRoleIds' | 'creatorRoleIds' | 'adminRoleIds' | 'inviteUrl'>) =>
    request<{ settings: AdminSettings }>('/settings', { method: 'PUT', body: JSON.stringify(settings) }),
};
