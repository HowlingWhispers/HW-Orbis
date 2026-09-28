export interface BigBrotherStats {
  total_messages: number;
  active_messages: number;
  deleted_messages: number;
  last_capture: string | null;
  memories: number;
}

export interface BigBrotherAttachment {
  id: string;
  name: string;
  size: number;
  contentType?: string | null;
}

export interface BigBrotherMessage {
  messageId: string;
  guildId: string;
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorBot: boolean;
  content: string;
  attachments: BigBrotherAttachment[];
  replyToMessageId: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  capturedAt: string;
}

export interface BigBrotherRevision {
  id: string;
  eventType: 'create' | 'edit' | 'delete';
  content: string;
  attachments: BigBrotherAttachment[];
  capturedAt: string;
}

export interface BigBrotherPerson {
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorBot: boolean;
  messages: number;
  lastSeen: string;
}

export interface BigBrotherChannel {
  channelId: string;
  channelName: string;
  messages: number;
  activePeople: number;
  lastMessageAt: string;
}

export type BigBrotherMemoryScope = 'server' | 'user' | 'channel' | 'message';

export interface BigBrotherMemory {
  id: string;
  guildId: string;
  scope: BigBrotherMemoryScope;
  subjectUserId: string | null;
  channelId: string | null;
  sourceMessageId: string | null;
  title: string;
  content: string;
  tags: string[];
  importance: number;
  pinned: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BigBrotherMemoryInput {
  guildId: string;
  scope?: BigBrotherMemoryScope;
  subjectUserId?: string | null;
  channelId?: string | null;
  sourceMessageId?: string | null;
  title?: string;
  content: string;
  tags?: string[];
  importance?: number;
  pinned?: boolean;
}

type MessageFilters = {
  q?: string;
  authorId?: string;
  channelId?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/big-brother${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error('Orbis could not reach Big Brother. Check the connection and try again.');
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(response.ok
      ? 'Big Brother returned an unexpected response.'
      : `Big Brother refused that request (HTTP ${response.status}).`);
  }
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Big Brother could not complete that request.');
  return data;
}

function queryString(values: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === '' || value === false) return;
    params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const bigBrotherApi = {
  stats: () => request<{ stats: BigBrotherStats }>('/stats'),
  messages: (filters: MessageFilters = {}) => request<{ items: BigBrotherMessage[]; limit: number; offset: number }>(
    '/messages' + queryString(filters),
  ),
  revisions: (messageId: string) => request<{ items: BigBrotherRevision[] }>(
    `/messages/${encodeURIComponent(messageId)}/revisions`,
  ),
  people: (days = 30) => request<{ items: BigBrotherPerson[]; days: number }>(`/people?days=${encodeURIComponent(String(days))}`),
  channels: (days = 30) => request<{ items: BigBrotherChannel[]; days: number }>(`/channels?days=${encodeURIComponent(String(days))}`),
  memories: (q = '', guildId = '') => request<{ items: BigBrotherMemory[] }>(
    '/memories' + queryString({ q, guildId }),
  ),
  createMemory: (input: BigBrotherMemoryInput) => request<{ item: BigBrotherMemory }>('/memories', {
    method: 'POST', body: JSON.stringify(input),
  }),
  updateMemory: (id: string, input: Partial<Omit<BigBrotherMemoryInput, 'guildId'>>) => request<{ item: BigBrotherMemory }>(
    `/memories/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) },
  ),
  deleteMemory: (id: string) => request<{ ok: boolean }>(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
