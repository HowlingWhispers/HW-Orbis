import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';

const DISCORD_API = 'https://discord.com/api/v10';
const snowflake = z.string().regex(/^\d{17,20}$/, 'Use an exact Discord ID.');
const auditId = z.string().regex(/^\d+$/, 'Use a valid Coda history ID.');
const messageContent = z.string().max(2000, 'Discord messages are limited to 2000 characters.').refine((value) => value.trim().length > 0, 'Message content is required.');

export const codaDiscordMessageSchema = z.object({
  channelId: snowflake,
  content: messageContent,
  replyTo: z.string().trim().max(300).optional().default(''),
});

export const codaDirectMessageSchema = z.object({
  recipient: z.string().trim().min(1).max(100),
  content: messageContent,
});

export const codaTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  content: messageContent,
});

export const codaScheduleSchema = z.object({
  destinationType: z.enum(['channel', 'dm']),
  targetId: snowflake,
  content: messageContent,
  replyTo: z.string().trim().max(300).optional().default(''),
  sendAt: z.string().datetime(),
});

export const codaControlSchema = z.object({ outboundEnabled: z.boolean() });
export const codaMessageEditSchema = z.object({ content: messageContent });

export type CodaDiscordMessageInput = z.output<typeof codaDiscordMessageSchema>;
export type CodaDirectMessageInput = z.output<typeof codaDirectMessageSchema>;
export type CodaScheduleInput = z.output<typeof codaScheduleSchema>;

interface DiscordGuildChannel {
  id: string;
  type: number;
  name: string;
  position?: number;
  parent_id?: string | null;
}

interface DiscordUser {
  id: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
}

interface DiscordGuildMember {
  user?: DiscordUser;
  nick?: string | null;
  avatar?: string | null;
}

interface DiscordMessageResponse { id?: string; }
interface DiscordDmChannel { id?: string; }
interface DiscordGuild { id?: string; name?: string; }

export interface CodaDiscordChannel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
}

export interface CodaDiscordMember {
  id: string;
  username: string;
  displayName: string;
  bot: boolean;
}

export interface CodaDiscordMessageRecord {
  id: string;
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

export interface CodaTemplate {
  id: string;
  name: string;
  content: string;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CodaScheduledMessage {
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

export class CodaDiscordError extends Error {
  constructor(public readonly httpStatus: number, message: string) {
    super(message);
    this.name = 'CodaDiscordError';
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function codaConfiguration(config: AppConfig, guildId: string) {
  return {
    botConfigured: Boolean(config.CODA_DISCORD_BOT_TOKEN && guildId),
    channelConfigured: Boolean(config.CODA_DISCORD_BOT_TOKEN && guildId && config.codaDiscordChannelIds.length > 0),
    allowedChannelIds: new Set(config.codaDiscordChannelIds),
  };
}

async function discordRequest(fetchImpl: FetchLike, token: string, path: string, init?: RequestInit) {
  return fetchImpl(DISCORD_API + path, {
    ...init,
    headers: {
      Authorization: 'Bot ' + token,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
}

function discordErrorMessage(response: Response, fallback: string) {
  if (response.status === 401) return 'Discord rejected Coda\'s bot token.';
  if (response.status === 403) return fallback + ' Check Coda\'s Discord permissions and intents.';
  if (response.status === 404) return fallback + ' The Discord target could not be found.';
  if (response.status === 429) return 'Discord is rate-limiting Coda. Try again shortly.';
  return fallback;
}

export async function getCodaControlState(pool: DatabasePool) {
  const result = await pool.query('SELECT outbound_enabled, updated_at, updated_by_user_id::text FROM coda_control_state WHERE singleton = true');
  const row = result.rows[0];
  return {
    outboundEnabled: row?.outbound_enabled !== false,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedByUserId: row?.updated_by_user_id ?? null,
  };
}

export async function setCodaControlState(pool: DatabasePool, userId: string, outboundEnabled: boolean) {
  const result = await pool.query(
    `INSERT INTO coda_control_state (singleton, outbound_enabled, updated_by_user_id, updated_at)
     VALUES (true, $1, $2, now())
     ON CONFLICT (singleton) DO UPDATE
       SET outbound_enabled = excluded.outbound_enabled, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
     RETURNING outbound_enabled, updated_at, updated_by_user_id::text`,
    [outboundEnabled, userId],
  );
  const row = result.rows[0];
  return { outboundEnabled: row.outbound_enabled, updatedAt: new Date(row.updated_at).toISOString(), updatedByUserId: row.updated_by_user_id };
}

async function assertOutboundEnabled(pool: DatabasePool) {
  const control = await getCodaControlState(pool);
  if (!control.outboundEnabled) throw new CodaDiscordError(423, 'Coda is in the kennel. Outbound Discord messages are disabled.');
}

export async function listCodaDiscordChannels(config: AppConfig, guildId: string, fetchImpl: FetchLike = fetch) {
  const state = codaConfiguration(config, guildId);
  if (!state.channelConfigured) {
    return {
      configured: false,
      guildId,
      items: [] as CodaDiscordChannel[],
      reason: 'Set CODA_DISCORD_BOT_TOKEN and CODA_DISCORD_CHANNEL_IDS on the Orbis server.',
    };
  }

  const response = await discordRequest(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, '/guilds/' + guildId + '/channels');
  if (!response.ok) throw new CodaDiscordError(502, discordErrorMessage(response, 'Coda could not read the configured Discord channels.'));

  const payload = await response.json();
  if (!Array.isArray(payload)) throw new CodaDiscordError(502, 'Discord returned an invalid channel list.');

  const items = payload
    .filter((value): value is DiscordGuildChannel => Boolean(value && typeof value === 'object' && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.type === 'number'))
    .filter((channel) => state.allowedChannelIds.has(channel.id) && (channel.type === 0 || channel.type === 5))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parent_id ?? null,
      position: channel.position ?? 0,
    }))
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));

  return { configured: true, guildId, items };
}

function parseUserId(value: string) {
  const trimmed = value.trim();
  const mention = trimmed.match(/^<@!?(\d{17,20})>$/);
  if (mention) return mention[1];
  if (/^\d{17,20}$/.test(trimmed)) return trimmed;
  return undefined;
}

function memberFromDiscord(member: DiscordGuildMember): CodaDiscordMember | undefined {
  const user = member.user;
  if (!user?.id) return undefined;
  return {
    id: user.id,
    username: user.username ?? user.id,
    displayName: member.nick?.trim() || user.global_name?.trim() || user.username || user.id,
    bot: Boolean(user.bot),
  };
}

export async function searchCodaDiscordMembers(config: AppConfig, guildId: string, query: string, fetchImpl: FetchLike = fetch) {
  const state = codaConfiguration(config, guildId);
  if (!state.botConfigured) throw new CodaDiscordError(409, 'Coda Discord access is not configured on the Orbis server.');
  const trimmed = query.trim();
  if (!trimmed) return [] as CodaDiscordMember[];

  const directId = parseUserId(trimmed);
  if (directId) {
    const response = await discordRequest(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, '/guilds/' + guildId + '/members/' + directId);
    if (response.status === 404) return [];
    if (!response.ok) throw new CodaDiscordError(502, discordErrorMessage(response, 'Coda could not look up that Discord member.'));
    const member = memberFromDiscord(await response.json() as DiscordGuildMember);
    return member ? [member] : [];
  }

  if (trimmed.length < 2) throw new CodaDiscordError(400, 'Type at least two characters to search Discord members.');
  const response = await discordRequest(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, '/guilds/' + guildId + '/members/search?query=' + encodeURIComponent(trimmed) + '&limit=25');
  if (!response.ok) throw new CodaDiscordError(502, discordErrorMessage(response, 'Coda could not search Discord members.'));
  const payload = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload.map((member) => memberFromDiscord(member as DiscordGuildMember)).filter((member): member is CodaDiscordMember => Boolean(member));
}

function parseReplyMessageId(value: string, guildId: string, channelId: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{17,20}$/.test(trimmed)) return trimmed;

  let url: URL;
  try { url = new URL(trimmed); } catch { throw new CodaDiscordError(400, 'Reply target must be a Discord message link or exact message ID.'); }
  if (!['discord.com', 'www.discord.com', 'canary.discord.com', 'ptb.discord.com'].includes(url.hostname)) {
    throw new CodaDiscordError(400, 'Reply target must be a Discord message link or exact message ID.');
  }
  const match = url.pathname.match(/^\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/);
  if (!match) throw new CodaDiscordError(400, 'Reply target must be a Discord message link or exact message ID.');
  if (match[1] !== guildId || match[2] !== channelId) throw new CodaDiscordError(400, 'The reply target must belong to the selected Discord channel.');
  return match[3];
}

async function writeMessageAudit(
  pool: DatabasePool,
  input: {
    sentByUserId: string;
    guildId: string;
    channelId: string;
    discordMessageId?: string;
    destinationType: 'channel' | 'dm';
    recipientUserId?: string;
    recipientDisplayName?: string;
    content: string;
    replyToMessageId?: string;
    status: 'sent' | 'failed';
    errorMessage?: string;
  },
) {
  try {
    const result = await pool.query(
      `INSERT INTO coda_discord_messages
         (sent_by_user_id, guild_id, channel_id, discord_message_id, destination_type, recipient_user_id, recipient_display_name, content, reply_to_message_id, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id::text, created_at`,
      [
        input.sentByUserId, input.guildId, input.channelId, input.discordMessageId ?? null, input.destinationType,
        input.recipientUserId ?? null, input.recipientDisplayName ?? null, input.content, input.replyToMessageId ?? null,
        input.status, input.errorMessage ?? null,
      ],
    );
    return result.rows[0] as { id: string; created_at: Date | string } | undefined;
  } catch (error) {
    console.error('Orbis could not record the Coda Discord audit entry.', error);
    return undefined;
  }
}

async function postDiscordMessage(fetchImpl: FetchLike, token: string, channelId: string, payload: Record<string, unknown>) {
  let response: Response;
  try {
    response = await discordRequest(fetchImpl, token, '/channels/' + channelId + '/messages', { method: 'POST', body: JSON.stringify(payload) });
  } catch {
    throw new CodaDiscordError(502, 'Coda could not reach Discord.');
  }
  const body = await response.json().catch(() => undefined) as DiscordMessageResponse | undefined;
  if (!response.ok || !body?.id) throw new CodaDiscordError(502, discordErrorMessage(response, response.ok ? 'Discord did not return a message ID.' : 'Discord rejected the message.'));
  return body.id;
}

export async function sendCodaDiscordMessage(
  config: AppConfig,
  pool: DatabasePool,
  guildId: string,
  sentByUserId: string,
  rawInput: CodaDiscordMessageInput,
  fetchImpl: FetchLike = fetch,
) {
  const input = codaDiscordMessageSchema.parse(rawInput);
  await assertOutboundEnabled(pool);
  const state = codaConfiguration(config, guildId);
  if (!state.channelConfigured) throw new CodaDiscordError(409, 'Coda Discord channel sending is not configured on the Orbis server.');
  if (!state.allowedChannelIds.has(input.channelId)) throw new CodaDiscordError(403, 'That Discord channel is not on Coda\'s server allowlist.');

  const channelState = await listCodaDiscordChannels(config, guildId, fetchImpl);
  if (!channelState.items.some((item) => item.id === input.channelId)) throw new CodaDiscordError(403, 'Coda cannot post to that Discord channel.');

  const replyToMessageId = parseReplyMessageId(input.replyTo, guildId, input.channelId);
  try {
    const discordMessageId = await postDiscordMessage(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, input.channelId, {
      content: input.content,
      allowed_mentions: { parse: ['users'], replied_user: true },
      ...(replyToMessageId ? { message_reference: { message_id: replyToMessageId, channel_id: input.channelId, guild_id: guildId, fail_if_not_exists: true } } : {}),
    });
    const audit = await writeMessageAudit(pool, { sentByUserId, guildId, channelId: input.channelId, discordMessageId, destinationType: 'channel', content: input.content, replyToMessageId, status: 'sent' });
    return {
      message: {
        id: audit?.id ?? discordMessageId, auditId: audit?.id ?? null, guildId, channelId: input.channelId, discordMessageId,
        destinationType: 'channel' as const, recipientUserId: null, recipientDisplayName: null, content: input.content,
        replyToMessageId: replyToMessageId ?? null, status: 'sent' as const, errorMessage: null, sentByUserId,
        sentByName: null, editedAt: null, deletedAt: null,
        createdAt: audit ? new Date(audit.created_at).toISOString() : new Date().toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discord rejected the message.';
    await writeMessageAudit(pool, { sentByUserId, guildId, channelId: input.channelId, destinationType: 'channel', content: input.content, replyToMessageId, status: 'failed', errorMessage: message });
    throw error;
  }
}

export async function sendCodaDirectMessage(
  config: AppConfig,
  pool: DatabasePool,
  guildId: string,
  sentByUserId: string,
  rawInput: CodaDirectMessageInput,
  fetchImpl: FetchLike = fetch,
) {
  const input = codaDirectMessageSchema.parse(rawInput);
  await assertOutboundEnabled(pool);
  const state = codaConfiguration(config, guildId);
  if (!state.botConfigured) throw new CodaDiscordError(409, 'Coda Discord access is not configured on the Orbis server.');

  const recipientUserId = parseUserId(input.recipient);
  if (!recipientUserId) throw new CodaDiscordError(400, 'Choose a Discord member or provide an exact Discord user ID/mention.');

  let recipientDisplayName: string | undefined;
  try {
    const matches = await searchCodaDiscordMembers(config, guildId, recipientUserId, fetchImpl);
    recipientDisplayName = matches[0]?.displayName;
  } catch {
    // A direct DM can still be attempted when member lookup is unavailable.
  }

  const dmResponse = await discordRequest(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, '/users/@me/channels', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: recipientUserId }),
  });
  const dmChannel = await dmResponse.json().catch(() => undefined) as DiscordDmChannel | undefined;
  if (!dmResponse.ok || !dmChannel?.id) throw new CodaDiscordError(502, discordErrorMessage(dmResponse, 'Coda could not open a private message with that user.'));

  try {
    const discordMessageId = await postDiscordMessage(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, dmChannel.id, {
      content: input.content,
      allowed_mentions: { parse: ['users'] },
    });
    const audit = await writeMessageAudit(pool, {
      sentByUserId, guildId, channelId: dmChannel.id, discordMessageId, destinationType: 'dm',
      recipientUserId, recipientDisplayName, content: input.content, status: 'sent',
    });
    return {
      message: {
        id: audit?.id ?? discordMessageId, auditId: audit?.id ?? null, guildId, channelId: dmChannel.id, discordMessageId,
        destinationType: 'dm' as const, recipientUserId, recipientDisplayName: recipientDisplayName ?? null, content: input.content,
        replyToMessageId: null, status: 'sent' as const, errorMessage: null, sentByUserId, sentByName: null,
        editedAt: null, deletedAt: null, createdAt: audit ? new Date(audit.created_at).toISOString() : new Date().toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discord rejected the private message.';
    await writeMessageAudit(pool, {
      sentByUserId, guildId, channelId: dmChannel.id, destinationType: 'dm', recipientUserId,
      recipientDisplayName, content: input.content, status: 'failed', errorMessage: message,
    });
    throw error;
  }
}

export async function listCodaDiscordMessageHistory(pool: DatabasePool, limit = 50): Promise<CodaDiscordMessageRecord[]> {
  const result = await pool.query(
    `SELECT m.id::text, m.guild_id, m.channel_id, m.discord_message_id, m.destination_type, m.recipient_user_id,
            m.recipient_display_name, m.content, m.reply_to_message_id, m.status, m.error_message,
            m.sent_by_user_id::text, u.display_name AS sent_by_name, m.edited_at, m.deleted_at, m.created_at
     FROM coda_discord_messages m
     LEFT JOIN users u ON u.id = m.sent_by_user_id
     ORDER BY m.created_at DESC
     LIMIT $1`,
    [Math.min(Math.max(Math.trunc(limit) || 50, 1), 100)],
  );

  return result.rows.map((row) => ({
    id: row.id, guildId: row.guild_id, channelId: row.channel_id, discordMessageId: row.discord_message_id,
    destinationType: row.destination_type ?? 'channel', recipientUserId: row.recipient_user_id ?? null,
    recipientDisplayName: row.recipient_display_name ?? null, content: row.content, replyToMessageId: row.reply_to_message_id,
    status: row.status, errorMessage: row.error_message, sentByUserId: row.sent_by_user_id, sentByName: row.sent_by_name,
    editedAt: row.edited_at ? new Date(row.edited_at).toISOString() : null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

async function historyRow(pool: DatabasePool, id: string) {
  const parsed = auditId.parse(id);
  const result = await pool.query(
    `SELECT id::text, channel_id, discord_message_id, content, destination_type, deleted_at
     FROM coda_discord_messages WHERE id = $1`,
    [parsed],
  );
  if (!result.rowCount) throw new CodaDiscordError(404, 'Coda history entry not found.');
  return result.rows[0];
}

export async function editCodaDiscordMessage(config: AppConfig, pool: DatabasePool, id: string, content: string, fetchImpl: FetchLike = fetch) {
  await assertOutboundEnabled(pool);
  const row = await historyRow(pool, id);
  if (!row.discord_message_id || row.deleted_at) throw new CodaDiscordError(409, 'That Coda message cannot be edited.');
  const parsed = codaMessageEditSchema.parse({ content });
  const response = await discordRequest(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, '/channels/' + row.channel_id + '/messages/' + row.discord_message_id, {
    method: 'PATCH',
    body: JSON.stringify({ content: parsed.content, allowed_mentions: { parse: ['users'] } }),
  });
  if (!response.ok) throw new CodaDiscordError(502, discordErrorMessage(response, 'Discord rejected the edit.'));
  await pool.query('UPDATE coda_discord_messages SET content = $2, edited_at = now() WHERE id = $1', [id, parsed.content]);
  return { ok: true };
}

export async function deleteCodaDiscordMessage(config: AppConfig, pool: DatabasePool, id: string, fetchImpl: FetchLike = fetch) {
  await assertOutboundEnabled(pool);
  const row = await historyRow(pool, id);
  if (!row.discord_message_id || row.deleted_at) throw new CodaDiscordError(409, 'That Coda message cannot be deleted.');
  const response = await discordRequest(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, '/channels/' + row.channel_id + '/messages/' + row.discord_message_id, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new CodaDiscordError(502, discordErrorMessage(response, 'Discord rejected the delete request.'));
  await pool.query('UPDATE coda_discord_messages SET deleted_at = now() WHERE id = $1', [id]);
  return { ok: true };
}

export async function listCodaTemplates(pool: DatabasePool): Promise<CodaTemplate[]> {
  const result = await pool.query(
    `SELECT t.id::text, t.name, t.content, t.created_by_user_id::text, u.display_name AS created_by_name, t.created_at, t.updated_at
     FROM coda_message_templates t LEFT JOIN users u ON u.id = t.created_by_user_id
     ORDER BY lower(t.name), t.id`,
  );
  return result.rows.map((row) => ({
    id: row.id, name: row.name, content: row.content, createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function createCodaTemplate(pool: DatabasePool, userId: string, raw: unknown) {
  const input = codaTemplateSchema.parse(raw);
  const result = await pool.query(
    `INSERT INTO coda_message_templates (name, content, created_by_user_id)
     VALUES ($1, $2, $3)
     RETURNING id::text, name, content, created_by_user_id::text, created_at, updated_at`,
    [input.name, input.content, userId],
  );
  const row = result.rows[0];
  return {
    id: row.id, name: row.name, content: row.content, createdByUserId: row.created_by_user_id,
    createdByName: null, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  } satisfies CodaTemplate;
}

export async function deleteCodaTemplate(pool: DatabasePool, id: string) {
  const parsed = auditId.parse(id);
  const result = await pool.query('DELETE FROM coda_message_templates WHERE id = $1 RETURNING id', [parsed]);
  if (!result.rowCount) throw new CodaDiscordError(404, 'Coda template not found.');
  return { ok: true };
}

export async function createCodaScheduledMessage(config: AppConfig, pool: DatabasePool, userId: string, raw: unknown) {
  const input = codaScheduleSchema.parse(raw);
  if (input.destinationType === 'channel' && !config.codaDiscordChannelIds.includes(input.targetId)) {
    throw new CodaDiscordError(403, 'That Discord channel is not on Coda\'s server allowlist.');
  }
  if (new Date(input.sendAt).getTime() <= Date.now()) throw new CodaDiscordError(400, 'Choose a future time for the scheduled message.');
  const result = await pool.query(
    `INSERT INTO coda_scheduled_messages (destination_type, target_id, content, reply_to, send_at, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id::text, destination_type, target_id, content, reply_to, send_at, status, last_error, created_by_user_id::text, created_at, updated_at`,
    [input.destinationType, input.targetId, input.content, input.replyTo, input.sendAt, userId],
  );
  return scheduledFromRow(result.rows[0]);
}

function scheduledFromRow(row: Record<string, any>): CodaScheduledMessage {
  return {
    id: String(row.id), destinationType: row.destination_type, targetId: row.target_id, content: row.content,
    replyTo: row.reply_to ?? '', sendAt: new Date(row.send_at).toISOString(), status: row.status, lastError: row.last_error ?? null,
    createdByUserId: row.created_by_user_id ?? null, createdByName: row.created_by_name ?? null,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listCodaScheduledMessages(pool: DatabasePool, limit = 100) {
  const result = await pool.query(
    `SELECT s.id::text, s.destination_type, s.target_id, s.content, s.reply_to, s.send_at, s.status, s.last_error,
            s.created_by_user_id::text, u.display_name AS created_by_name, s.created_at, s.updated_at
     FROM coda_scheduled_messages s LEFT JOIN users u ON u.id = s.created_by_user_id
     ORDER BY CASE WHEN s.status = 'queued' THEN 0 ELSE 1 END, s.send_at ASC
     LIMIT $1`,
    [Math.min(Math.max(Math.trunc(limit) || 100, 1), 200)],
  );
  return result.rows.map(scheduledFromRow);
}

export async function cancelCodaScheduledMessage(pool: DatabasePool, id: string) {
  const parsed = auditId.parse(id);
  const result = await pool.query(
    `UPDATE coda_scheduled_messages SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND status = 'queued' RETURNING id`,
    [parsed],
  );
  if (!result.rowCount) throw new CodaDiscordError(409, 'Only queued Coda messages can be cancelled.');
  return { ok: true };
}

export async function processDueCodaScheduledMessages(config: AppConfig, pool: DatabasePool, guildId: string, fetchImpl: FetchLike = fetch) {
  const control = await getCodaControlState(pool);
  if (!control.outboundEnabled || !config.CODA_DISCORD_BOT_TOKEN || !guildId) return { processed: 0 };

  let processed = 0;
  for (let index = 0; index < 10; index += 1) {
    const claimed = await pool.query(
      `UPDATE coda_scheduled_messages
       SET status = 'sending', updated_at = now()
       WHERE id = (
         SELECT id FROM coda_scheduled_messages
         WHERE status = 'queued' AND send_at <= now()
         ORDER BY send_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id::text, destination_type, target_id, content, reply_to, send_at, created_by_user_id::text, created_at, updated_at, status, last_error`,
    );
    if (!claimed.rowCount) break;
    const item = claimed.rows[0];
    try {
      const result = item.destination_type === 'channel'
        ? await sendCodaDiscordMessage(config, pool, guildId, item.created_by_user_id, { channelId: item.target_id, content: item.content, replyTo: item.reply_to ?? '' }, fetchImpl)
        : await sendCodaDirectMessage(config, pool, guildId, item.created_by_user_id, { recipient: item.target_id, content: item.content }, fetchImpl);
      await pool.query(
        `UPDATE coda_scheduled_messages SET status = 'sent', sent_discord_message_id = $2, sent_message_audit_id = $3, last_error = NULL, updated_at = now() WHERE id = $1`,
        [item.id, result.message.discordMessageId, result.message.auditId],
      );
    } catch (error) {
      await pool.query(
        `UPDATE coda_scheduled_messages SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
        [item.id, error instanceof Error ? error.message.slice(0, 500) : 'Unknown scheduling error'],
      );
    }
    processed += 1;
  }
  return { processed };
}

export async function getCodaDiscordStatus(config: AppConfig, pool: DatabasePool, guildId: string, fetchImpl: FetchLike = fetch) {
  const control = await getCodaControlState(pool);
  const queued = await pool.query(`SELECT count(*)::int AS count FROM coda_scheduled_messages WHERE status = 'queued'`);
  const recent = await pool.query(`SELECT created_at FROM coda_discord_messages ORDER BY created_at DESC LIMIT 1`);
  const base = {
    configured: Boolean(config.CODA_DISCORD_BOT_TOKEN && guildId),
    outboundEnabled: control.outboundEnabled,
    allowedChannelCount: config.codaDiscordChannelIds.length,
    queuedScheduled: Number(queued.rows[0]?.count ?? 0),
    lastMessageAt: recent.rows[0]?.created_at ? new Date(recent.rows[0].created_at).toISOString() : null,
    bot: null as null | { id: string; username: string; globalName: string | null },
    guild: null as null | { id: string; name: string },
  };
  if (!base.configured) return base;

  const [userResponse, guildResponse] = await Promise.all([
    discordRequest(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, '/users/@me'),
    discordRequest(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, '/guilds/' + guildId),
  ]);
  if (!userResponse.ok) throw new CodaDiscordError(502, discordErrorMessage(userResponse, 'Coda could not authenticate with Discord.'));
  const user = await userResponse.json() as DiscordUser;
  base.bot = { id: user.id, username: user.username ?? user.id, globalName: user.global_name ?? null };
  if (guildResponse.ok) {
    const guild = await guildResponse.json() as DiscordGuild;
    if (guild.id && guild.name) base.guild = { id: guild.id, name: guild.name };
  }
  return base;
}
