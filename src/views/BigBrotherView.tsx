import {
  Activity, Bot, ChevronLeft, ChevronRight, Clock, Database, ExternalLink,
  Hash, History, MessageSquareText, Pin, Save, Search,
  Trash2, UserRound, UsersRound,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from '../admin/api';
import {
  bigBrotherApi,
  type BigBrotherChannel,
  type BigBrotherMemory,
  type BigBrotherMemoryScope,
  type BigBrotherMessage,
  type BigBrotherPerson,
  type BigBrotherRevision,
  type BigBrotherStats,
} from '../admin/bigBrotherApi';
import { useAuth } from '../auth/AuthContext';
import '../styles/big-brother.css';

type BigBrotherTab = 'messages' | 'memory' | 'people' | 'channels';

type MemoryDraft = {
  guildId: string;
  scope: BigBrotherMemoryScope;
  subjectUserId: string;
  channelId: string;
  sourceMessageId: string;
  title: string;
  content: string;
  tags: string;
  importance: number;
  pinned: boolean;
};

const emptyDraft: MemoryDraft = {
  guildId: '', scope: 'server', subjectUserId: '', channelId: '', sourceMessageId: '',
  title: '', content: '', tags: '', importance: 3, pinned: false,
};

function dateLabel(value: string | null | undefined) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function displayPerson(person: Pick<BigBrotherPerson, 'authorName' | 'authorUsername' | 'authorId'>) {
  return person.authorName || person.authorUsername || person.authorId;
}

export function BigBrotherConsole() {
  const { user } = useAuth();
  const canAdmin = Boolean(user?.permissions.canAdmin);
  const [tab, setTab] = useState<BigBrotherTab>('messages');
  const [stats, setStats] = useState<BigBrotherStats>();
  const [messages, setMessages] = useState<BigBrotherMessage[]>([]);
  const [people, setPeople] = useState<BigBrotherPerson[]>([]);
  const [channels, setChannels] = useState<BigBrotherChannel[]>([]);
  const [memories, setMemories] = useState<BigBrotherMemory[]>([]);
  const [guildId, setGuildId] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [authorId, setAuthorId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [offset, setOffset] = useState(0);
  const pageSize = 50;

  const [memorySearchDraft, setMemorySearchDraft] = useState('');
  const [memorySearch, setMemorySearch] = useState('');
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft>(emptyDraft);

  const [revisionMessageId, setRevisionMessageId] = useState('');
  const [revisions, setRevisions] = useState<BigBrotherRevision[]>([]);
  const [revisionLoading, setRevisionLoading] = useState(false);

  const loadStats = useCallback(async () => {
    const result = await bigBrotherApi.stats();
    setStats(result.stats);
  }, []);

  const loadMessages = useCallback(async () => {
    const result = await bigBrotherApi.messages({
      q: search,
      authorId,
      channelId,
      includeDeleted,
      limit: pageSize,
      offset,
    });
    setMessages(result.items);
  }, [authorId, channelId, includeDeleted, offset, search]);

  const loadPeople = useCallback(async () => {
    const result = await bigBrotherApi.people(30);
    setPeople(result.items);
  }, []);

  const loadChannels = useCallback(async () => {
    const result = await bigBrotherApi.channels(30);
    setChannels(result.items);
  }, []);

  const loadMemories = useCallback(async () => {
    const result = await bigBrotherApi.memories(memorySearch, guildId);
    setMemories(result.items);
  }, [guildId, memorySearch]);

  const loadInitial = useCallback(async () => {
    if (!canAdmin) return;
    setLoading(true);
    setError('');
    try {
      const [statsResult, peopleResult, channelResult, settingsResult] = await Promise.all([
        bigBrotherApi.stats(), bigBrotherApi.people(30), bigBrotherApi.channels(30), adminApi.settings(),
      ]);
      setStats(statsResult.stats);
      setPeople(peopleResult.items);
      setChannels(channelResult.items);
      setGuildId(settingsResult.settings.guildId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Big Brother could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [canAdmin]);

  useEffect(() => { void loadInitial(); }, [loadInitial]);
  useEffect(() => {
    if (!canAdmin) return;
    void loadMessages().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Messages could not be loaded.'));
  }, [canAdmin, loadMessages]);
  useEffect(() => {
    if (!canAdmin || tab !== 'memory') return;
    void loadMemories().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Memory could not be loaded.'));
  }, [canAdmin, loadMemories, tab]);
  useEffect(() => {
    if (!guildId || memoryDraft.guildId) return;
    setMemoryDraft((current) => ({ ...current, guildId }));
  }, [guildId, memoryDraft.guildId]);

  useEffect(() => {
    if (!canAdmin) return;
    const timer = window.setInterval(() => {
      void loadStats().catch(() => undefined);
      if (tab === 'messages') void loadMessages().catch(() => undefined);
      if (tab === 'memory') void loadMemories().catch(() => undefined);
      if (tab === 'people') void loadPeople().catch(() => undefined);
      if (tab === 'channels') void loadChannels().catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [canAdmin, loadChannels, loadMemories, loadMessages, loadPeople, loadStats, tab]);

  const knownAuthors = useMemo(() => people.filter((item) => !item.authorBot || item.authorName), [people]);
  const selectedRevisionMessage = useMemo(
    () => messages.find((message) => message.messageId === revisionMessageId),
    [messages, revisionMessageId],
  );

  const applySearch = (event: FormEvent) => {
    event.preventDefault();
    setOffset(0);
    setSearch(searchDraft.trim());
  };

  const showRevisions = async (messageId: string) => {
    if (revisionMessageId === messageId) {
      setRevisionMessageId(''); setRevisions([]); return;
    }
    setRevisionMessageId(messageId); setRevisionLoading(true); setRevisions([]);
    try {
      const result = await bigBrotherApi.revisions(messageId);
      setRevisions(result.items);
    } catch (revisionError) {
      setError(revisionError instanceof Error ? revisionError.message : 'Revision history could not be loaded.');
    } finally { setRevisionLoading(false); }
  };

  const rememberMessage = (message: BigBrotherMessage) => {
    setMemoryDraft({
      guildId: message.guildId,
      scope: 'message',
      subjectUserId: message.authorId,
      channelId: message.channelId,
      sourceMessageId: message.messageId,
      title: `${message.authorName || message.authorUsername || 'Discord member'} in #${message.channelName || message.channelId}`,
      content: message.content,
      tags: '',
      importance: 3,
      pinned: false,
    });
    setTab('memory');
    setNotice('Message loaded into Memory. Edit the note before saving if you want.');
  };

  const resetMemoryDraft = () => setMemoryDraft({ ...emptyDraft, guildId });

  const saveMemory = async (event: FormEvent) => {
    event.preventDefault();
    if (!memoryDraft.guildId || !memoryDraft.content.trim()) return;
    setWorking(true); setError(''); setNotice('');
    try {
      await bigBrotherApi.createMemory({
        guildId: memoryDraft.guildId,
        scope: memoryDraft.scope,
        subjectUserId: memoryDraft.subjectUserId || null,
        channelId: memoryDraft.channelId || null,
        sourceMessageId: memoryDraft.sourceMessageId || null,
        title: memoryDraft.title.trim(),
        content: memoryDraft.content.trim(),
        tags: [...new Set(memoryDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean))],
        importance: memoryDraft.importance,
        pinned: memoryDraft.pinned,
      });
      resetMemoryDraft();
      await Promise.all([loadMemories(), loadStats()]);
      setNotice('Memory saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Memory could not be saved.');
    } finally { setWorking(false); }
  };

  const togglePinned = async (memory: BigBrotherMemory) => {
    setWorking(true); setError('');
    try {
      await bigBrotherApi.updateMemory(memory.id, { pinned: !memory.pinned });
      await loadMemories();
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : 'Memory could not be updated.');
    } finally { setWorking(false); }
  };

  const deleteMemory = async (memory: BigBrotherMemory) => {
    if (!window.confirm(`Delete this Coda memory${memory.title ? `: ${memory.title}` : ''}?`)) return;
    setWorking(true); setError('');
    try {
      await bigBrotherApi.deleteMemory(memory.id);
      await Promise.all([loadMemories(), loadStats()]);
      setNotice('Memory deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Memory could not be deleted.');
    } finally { setWorking(false); }
  };

  return (
    <div className="bb-page">
      {loading && <div className="admin-loading">Opening Big Brother...</div>}
      {error && <div className="bb-error" role="alert">{error}</div>}
      {notice && <div className="bb-notice" role="status">{notice}</div>}

    <section className="bb-stat-grid" aria-label="Big Brother status">
      <div className="bb-stat"><span><MessageSquareText size={16} /> Archived</span><strong>{stats?.total_messages ?? 0}</strong><small>message records</small></div>
      <div className="bb-stat"><span><Activity size={16} /> Active</span><strong>{stats?.active_messages ?? 0}</strong><small>not deleted</small></div>
      <div className="bb-stat"><span><Database size={16} /> Memory</span><strong>{stats?.memories ?? 0}</strong><small>durable notes</small></div>
      <div className="bb-stat"><span><Clock size={16} /> Last capture</span><strong style={{ fontSize: '.95rem' }}>{dateLabel(stats?.last_capture)}</strong><small>{stats?.deleted_messages ?? 0} deleted/redacted</small></div>
    </section>

    <nav className="bb-tabs" aria-label="Big Brother sections">
      <button className={tab === 'messages' ? 'is-active' : ''} onClick={() => setTab('messages')}><MessageSquareText size={15} /> Messages</button>
      <button className={tab === 'memory' ? 'is-active' : ''} onClick={() => setTab('memory')}><Database size={15} /> Memory</button>
      <button className={tab === 'people' ? 'is-active' : ''} onClick={() => setTab('people')}><UsersRound size={15} /> People</button>
      <button className={tab === 'channels' ? 'is-active' : ''} onClick={() => setTab('channels')}><Hash size={15} /> Channels</button>
    </nav>

    {tab === 'messages' && <section className="bb-panel">
      <div className="bb-panel__header"><div><h2>Discord messages</h2><p>Live server archive with author/channel filters and edit history.</p></div></div>
      <form className="bb-toolbar" onSubmit={applySearch}>
        <label className="bb-search"><Search size={16} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search messages, names or channels..." /></label>
        <select className="bb-select" value={authorId} onChange={(event) => { setAuthorId(event.target.value); setOffset(0); }} aria-label="Filter author">
          <option value="">All people</option>
          {knownAuthors.map((person) => <option key={person.authorId} value={person.authorId}>{displayPerson(person)}{person.authorBot ? ' [bot]' : ''}</option>)}
        </select>
        <select className="bb-select" value={channelId} onChange={(event) => { setChannelId(event.target.value); setOffset(0); }} aria-label="Filter channel">
          <option value="">All channels</option>
          {channels.map((channel) => <option key={channel.channelId} value={channel.channelId}>#{channel.channelName || channel.channelId}</option>)}
        </select>
        <label className="bb-toggle"><input type="checkbox" checked={includeDeleted} onChange={(event) => { setIncludeDeleted(event.target.checked); setOffset(0); }} /> show deleted</label>
        <button className="bb-button" type="submit"><Search size={15} /> Search</button>
      </form>

      <div className="bb-list">
        {messages.map((message) => <article className={`bb-card ${message.deletedAt ? 'is-deleted' : ''}`} key={message.messageId}>
          <div className="bb-card__meta">
            {message.authorBot ? <Bot size={15} /> : <UserRound size={15} />}
            <strong>{message.authorName || message.authorUsername || message.authorId}</strong>
            <span>@{message.authorUsername || message.authorId}</span>
            <span>#{message.channelName || message.channelId}</span>
            <span>{dateLabel(message.createdAt)}</span>
            {message.editedAt && <span className="bb-chip is-warn">edited</span>}
            {message.deletedAt && <span className="bb-chip is-danger">deleted · content redacted</span>}
          </div>
          <div className="bb-card__body">{message.deletedAt ? '[deleted from Discord]' : (message.content || '[no text]')}</div>
          {!message.deletedAt && message.attachments.length > 0 && <div className="bb-card__meta">{message.attachments.map((attachment) => <span className="bb-chip" key={attachment.id}>{attachment.name} · {Math.ceil(attachment.size / 1024)} KB</span>)}</div>}
          <div className="bb-card__actions">
            {!message.deletedAt && message.content && <button className="bb-button" onClick={() => rememberMessage(message)}><Database size={14} /> Remember this</button>}
            <button className="bb-button" onClick={() => void showRevisions(message.messageId)}><History size={14} /> {revisionMessageId === message.messageId ? 'Hide history' : 'History'}</button>
            <a className="bb-button" href={`https://discord.com/channels/${message.guildId}/${message.channelId}/${message.messageId}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Discord</a>
          </div>
          {revisionMessageId === message.messageId && <div className="bb-revisions">
            {revisionLoading && <small>Loading history...</small>}
            {!revisionLoading && revisions.length === 0 && <small>No revision history.</small>}
            {!revisionLoading && revisions.map((revision) => <div className="bb-revision" key={revision.id}>
              <small>{revision.eventType.toUpperCase()} · {dateLabel(revision.capturedAt)}</small>
              <pre>{revision.eventType === 'delete' ? '[deleted content redacted]' : (revision.content || '[no previous text available]')}</pre>
            </div>)}
          </div>}
        </article>)}
        {!messages.length && !loading && <div className="bb-empty">No messages match these filters yet.</div>}
      </div>

      <div className="bb-pagination">
        <button className="bb-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}><ChevronLeft size={15} /> Newer</button>
        <span>Showing {messages.length ? offset + 1 : 0}–{offset + messages.length}</span>
        <button className="bb-button" disabled={messages.length < pageSize} onClick={() => setOffset(offset + pageSize)}>Older <ChevronRight size={15} /></button>
      </div>
    </section>}

    {tab === 'memory' && <section className="bb-panel">
      <div className="bb-panel__header"><div><h2>Coda memory</h2><p>Durable admin-curated context. Source-linked memories are invalidated if their Discord message is edited or deleted.</p></div></div>
      <div className="bb-grid-two">
        <form className="bb-card bb-memory-form" onSubmit={saveMemory}>
          <div className="bb-memory-card__heading"><div><strong>New memory</strong><small>{memoryDraft.sourceMessageId ? `Source message ${memoryDraft.sourceMessageId}` : 'Manual memory'}</small></div>{memoryDraft.sourceMessageId && <button className="bb-button" type="button" onClick={resetMemoryDraft}>Clear source</button>}</div>
          <label className="bb-field"><span>Title</span><input className="bb-input" value={memoryDraft.title} onChange={(event) => setMemoryDraft({ ...memoryDraft, title: event.target.value })} placeholder="Short memory title" /></label>
          <label className="bb-field"><span>Memory</span><textarea className="bb-textarea" value={memoryDraft.content} onChange={(event) => setMemoryDraft({ ...memoryDraft, content: event.target.value })} placeholder="What should Coda/Kilo remember?" /></label>
          <div className="bb-form-row">
            <label className="bb-field"><span>Scope</span><select className="bb-select" value={memoryDraft.scope} onChange={(event) => setMemoryDraft({ ...memoryDraft, scope: event.target.value as BigBrotherMemoryScope })}><option value="server">Server</option><option value="user">User</option><option value="channel">Channel</option><option value="message">Message</option></select></label>
            <label className="bb-field"><span>Importance</span><select className="bb-select" value={memoryDraft.importance} onChange={(event) => setMemoryDraft({ ...memoryDraft, importance: Number(event.target.value) })}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
          </div>
          <div className="bb-form-row">
            <label className="bb-field"><span>User ID (optional)</span><input className="bb-input" value={memoryDraft.subjectUserId} onChange={(event) => setMemoryDraft({ ...memoryDraft, subjectUserId: event.target.value })} /></label>
            <label className="bb-field"><span>Channel ID (optional)</span><input className="bb-input" value={memoryDraft.channelId} onChange={(event) => setMemoryDraft({ ...memoryDraft, channelId: event.target.value })} /></label>
          </div>
          <label className="bb-field"><span>Tags, comma-separated</span><input className="bb-input" value={memoryDraft.tags} onChange={(event) => setMemoryDraft({ ...memoryDraft, tags: event.target.value })} placeholder="fabula, decision, multiplayer" /></label>
          <div className="bb-form-footer"><label className="bb-toggle"><input type="checkbox" checked={memoryDraft.pinned} onChange={(event) => setMemoryDraft({ ...memoryDraft, pinned: event.target.checked })} /> pin memory</label><button className="bb-button" disabled={working || !memoryDraft.guildId || !memoryDraft.content.trim()}><Save size={15} /> Save memory</button></div>
          {!memoryDraft.guildId && <div className="bb-notice">Configure the Discord guild in Orbis Admin before creating server memories.</div>}
        </form>

        <div className="bb-list">
          <form className="bb-toolbar" onSubmit={(event) => { event.preventDefault(); setMemorySearch(memorySearchDraft.trim()); }}><label className="bb-search"><Search size={16} /><input value={memorySearchDraft} onChange={(event) => setMemorySearchDraft(event.target.value)} placeholder="Search Coda memory..." /></label><button className="bb-button">Search</button></form>
          {memories.map((memory) => <article className="bb-card" key={memory.id}>
            <div className="bb-memory-card__heading"><div><strong>{memory.title || 'Untitled memory'}</strong><small>{memory.scope} · updated {dateLabel(memory.updatedAt)}</small></div>{memory.pinned && <Pin size={16} />}</div>
            <div className="bb-card__body">{memory.content}</div>
            <div className="bb-card__meta"><span className="bb-importance">{'★'.repeat(memory.importance)}{'☆'.repeat(5 - memory.importance)}</span>{memory.sourceMessageId && <span>source {memory.sourceMessageId}</span>}{memory.subjectUserId && <span>user {memory.subjectUserId}</span>}{memory.channelId && <span>channel {memory.channelId}</span>}</div>
            {memory.tags.length > 0 && <div className="bb-memory-card__tags">{memory.tags.map((tag) => <span className="bb-chip" key={tag}>{tag}</span>)}</div>}
            <div className="bb-card__actions"><button className="bb-button" disabled={working} onClick={() => void togglePinned(memory)}><Pin size={14} /> {memory.pinned ? 'Unpin' : 'Pin'}</button><button className="bb-button is-danger" disabled={working} onClick={() => void deleteMemory(memory)}><Trash2 size={14} /> Delete</button></div>
          </article>)}
          {!memories.length && <div className="bb-empty">No durable memories yet.</div>}
        </div>
      </div>
    </section>}

    {tab === 'people' && <section className="bb-panel">
      <div className="bb-panel__header"><div><h2>People</h2><p>Thirty-day message activity. Select a person to jump back into the message archive.</p></div></div>
      <div className="bb-table-wrap"><table className="bb-table"><thead><tr><th>Person</th><th>Messages</th><th>Last seen</th><th>Type</th></tr></thead><tbody>{people.map((person) => <tr data-clickable="true" key={person.authorId} onClick={() => { setAuthorId(person.authorId); setOffset(0); setTab('messages'); }}><td>{displayPerson(person)}<br /><small>@{person.authorUsername || person.authorId}</small></td><td>{person.messages}</td><td>{dateLabel(person.lastSeen)}</td><td>{person.authorBot ? 'Bot' : 'Member'}</td></tr>)}</tbody></table></div>
      {!people.length && <div className="bb-empty">No people have been captured yet.</div>}
    </section>}

    {tab === 'channels' && <section className="bb-panel">
      <div className="bb-panel__header"><div><h2>Channels</h2><p>Thirty-day activity by Discord channel. Select a channel to inspect its messages.</p></div></div>
      <div className="bb-table-wrap"><table className="bb-table"><thead><tr><th>Channel</th><th>Messages</th><th>People</th><th>Last message</th></tr></thead><tbody>{channels.map((channel) => <tr data-clickable="true" key={channel.channelId} onClick={() => { setChannelId(channel.channelId); setOffset(0); setTab('messages'); }}><td>#{channel.channelName || channel.channelId}</td><td>{channel.messages}</td><td>{channel.activePeople}</td><td>{dateLabel(channel.lastMessageAt)}</td></tr>)}</tbody></table></div>
      {!channels.length && <div className="bb-empty">No channel activity has been captured yet.</div>}
    </section>}

    {selectedRevisionMessage?.deletedAt && <div className="bb-notice">Deletion privacy is active: deleted Discord text and attachment metadata are removed from the current record and revision history.</div>}
    </div>
  );
}
