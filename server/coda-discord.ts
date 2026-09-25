import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { DatabasePool } from './db.js';

const DISCORD_API = 'https://discord.com/api/v10';
const snowflake = z.string().regex(/^\d{17,20}$/, 'Use an exact Discord ID.');

export const codaDiscordMessageSchema = z.object({
  channelId: snowflake,
  content: z.string().max(2000, 'Discord messages are limited to 2000 characters.').refine((value) => value.trim().length > 0, 'Message content is required.'),
  replyTo: z.string().trim().max(300).optional().default(''),
});

export type CodaDiscordMessageInput = z.output<typeof codaDiscordMessageSchema>;

interface DiscordGuildChannel {
  id: string;
  type: number;
  name: string;
  position?: number;
  parent_id?: string | null;
}

interface DiscordMessageResponse {
  id?: string;
}

export interface CodaDiscordChannel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
}

export interface CodaDiscordMessageRecord {
  id: string;
  guildId: string;
  channelId: string;
  discordMessageId: string | null;
  content: string;
  replyToMessageId: string | null;
  status: 'sent' | 'failed';
  errorMessage: string | null;
  sentByUserId: string | null;
  sentByName: string | null;
  createdAt: string;
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
    configured: Boolean(config.CODA_DISCORD_BOT_TOKEN && guildId && config.codaDiscordChannelIds.length > 0),
    allowedChannelIds: new Set(config.codaDiscordChannelIds),
  };
}

async function discordRequest(fetchImpl: FetchLike, token: string, path: string, init?: RequestInit) {
  const response = await fetchImpl(DISCORD_API + path, {
    ...init,
    headers: {
      Authorization: 'Bot ' + token,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  return response;
}

export async function listCodaDiscordChannels(config: AppConfig, guildId: string, fetchImpl: FetchLike = fetch) {
  const state = codaConfiguration(config, guildId);
  if (!state.configured) {
    return {
      configured: false,
      guildId,
      items: [] as CodaDiscordChannel[],
      reason: 'Set CODA_DISCORD_BOT_TOKEN and CODA_DISCORD_CHANNEL_IDS on the Orbis server.',
    };
  }

  const response = await discordRequest(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, '/guilds/' + guildId + '/channels');
  if (!response.ok) throw new CodaDiscordError(502, 'Coda could not read the configured Discord channels.');

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
    content: string;
    replyToMessageId?: string;
    status: 'sent' | 'failed';
    errorMessage?: string;
  },
) {
  try {
    const result = await pool.query(
      `INSERT INTO coda_discord_messages
         (sent_by_user_id, guild_id, channel_id, discord_message_id, content, reply_to_message_id, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id::text, created_at`,
      [input.sentByUserId, input.guildId, input.channelId, input.discordMessageId ?? null, input.content, input.replyToMessageId ?? null, input.status, input.errorMessage ?? null],
    );
    return result.rows[0] as { id: string; created_at: Date | string } | undefined;
  } catch (error) {
    console.error('Orbis could not record the Coda Discord audit entry.', error);
    return undefined;
  }
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
  const state = codaConfiguration(config, guildId);
  if (!state.configured) throw new CodaDiscordError(409, 'Coda Discord sending is not configured on the Orbis server.');
  if (!state.allowedChannelIds.has(input.channelId)) throw new CodaDiscordError(403, 'That Discord channel is not on Coda\'s server allowlist.');

  const channelState = await listCodaDiscordChannels(config, guildId, fetchImpl);
  const channel = channelState.items.find((item) => item.id === input.channelId);
  if (!channel) throw new CodaDiscordError(403, 'Coda cannot post to that Discord channel.');

  const replyToMessageId = parseReplyMessageId(input.replyTo, guildId, input.channelId);
  const payload = {
    content: input.content,
    allowed_mentions: { parse: ['users'], replied_user: true },
    ...(replyToMessageId ? { message_reference: { message_id: replyToMessageId, channel_id: input.channelId, guild_id: guildId, fail_if_not_exists: true } } : {}),
  };

  let response: Response;
  try {
    response = await discordRequest(fetchImpl, config.CODA_DISCORD_BOT_TOKEN, '/channels/' + input.channelId + '/messages', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch {
    await writeMessageAudit(pool, { sentByUserId, guildId, channelId: input.channelId, content: input.content, replyToMessageId, status: 'failed', errorMessage: 'Discord network request failed.' });
    throw new CodaDiscordError(502, 'Coda could not reach Discord.');
  }

  const responseBody = await response.json().catch(() => undefined) as DiscordMessageResponse | undefined;
  if (!response.ok || !responseBody?.id) {
    const errorMessage = response.ok ? 'Discord did not return a message ID.' : 'Discord rejected the message.';
    await writeMessageAudit(pool, { sentByUserId, guildId, channelId: input.channelId, content: input.content, replyToMessageId, status: 'failed', errorMessage });
    throw new CodaDiscordError(502, errorMessage);
  }

  const audit = await writeMessageAudit(pool, {
    sentByUserId,
    guildId,
    channelId: input.channelId,
    discordMessageId: responseBody.id,
    content: input.content,
    replyToMessageId,
    status: 'sent',
  });

  return {
    message: {
      id: audit?.id ?? responseBody.id,
      guildId,
      channelId: input.channelId,
      discordMessageId: responseBody.id,
      content: input.content,
      replyToMessageId: replyToMessageId ?? null,
      status: 'sent' as const,
      errorMessage: null,
      sentByUserId,
      sentByName: null,
      createdAt: audit ? new Date(audit.created_at).toISOString() : new Date().toISOString(),
    },
  };
}

export async function listCodaDiscordMessageHistory(pool: DatabasePool, limit = 20): Promise<CodaDiscordMessageRecord[]> {
  const result = await pool.query(
    `SELECT m.id::text, m.guild_id, m.channel_id, m.discord_message_id, m.content, m.reply_to_message_id,
            m.status, m.error_message, m.sent_by_user_id::text, u.display_name AS sent_by_name, m.created_at
     FROM coda_discord_messages m
     LEFT JOIN users u ON u.id = m.sent_by_user_id
     ORDER BY m.created_at DESC
     LIMIT $1`,
    [Math.min(Math.max(Math.trunc(limit) || 20, 1), 100)],
  );

  return result.rows.map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    discordMessageId: row.discord_message_id,
    content: row.content,
    replyToMessageId: row.reply_to_message_id,
    status: row.status,
    errorMessage: row.error_message,
    sentByUserId: row.sent_by_user_id,
    sentByName: row.sent_by_name,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
