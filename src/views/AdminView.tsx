import { Activity, BookOpen, Clock, Database, History, KeyRound, MessageCircle, MessageSquareText, Pencil, Power, RefreshCw, Save, Scissors, Search, Send, ServerCog, Settings2, ShieldCheck, Trash2, User, UsersRound, Wifi } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminApi, type AdminAuditEntry, type AdminCodaChannel, type AdminCodaMember, type AdminCodaMessage,
  type AdminCodaScheduled, type AdminCodaStatus, type AdminCodaTemplate, type AdminOverview, type AdminSettings,
} from '../admin/api';
import { CODA_COMPOSED_MAX_LENGTH, CODA_MESSAGE_MAX_LENGTH, codaMessagePartCount } from '../admin/codaMessage';
import { discordLoginPath, useAuth } from '../auth/AuthContext';

type AdminTab = 'overview' | 'discord' | 'coda' | 'access' | 'system';
type EditableSettings = Pick<AdminSettings, 'guildId' | 'adultRoleIds' | 'creatorRoleIds' | 'adminRoleIds' | 'inviteUrl'>;

const splitIds = (value: string) => [...new Set(value.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean))];
const joinIds = (ids: string[]) => ids.join('\n');

export function AdminView() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<AdminOverview>();
  const [settings, setSettings] = useState<AdminSettings>();
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [roleResolution, setRoleResolution] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user?.permissions.canAdmin) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [overviewData, settingsData, auditData] = await Promise.all([adminApi.overview(), adminApi.settings(), adminApi.audit()]);
      setOverview(overviewData); setSettings(settingsData.settings); setAudit(auditData.items); setRoleResolution(settingsData.roleResolution.reason);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'The control room could not be opened.'); }
    finally { setLoading(false); }
  }, [user?.permissions.canAdmin]);

  useEffect(() => { void load(); }, [load]);

  if (authLoading) return <AdminFrame><div className="admin-loading">Checking administrator access...</div></AdminFrame>;
  if (!user) return <AdminFrame><AdminDenied title="Discord sign-in required" body="Sign in before entering the Orbis control room." action={<a className="button button--discord" href={discordLoginPath('/admin')}>Sign in with Discord</a>} /></AdminFrame>;
  if (!user.permissions.canAdmin) return <AdminFrame><AdminDenied title="Administrator access required" body="Your Discord account does not have an approved Orbis administrator or recovery role." /></AdminFrame>;

  return (
    <AdminFrame>
      <nav className="admin-tabs" aria-label="Orbis administration sections">
        {(['overview', 'discord', 'coda', 'access', 'system'] as AdminTab[]).map((item) => <button key={item} className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{item}</button>)}
      </nav>
      {loading && <div className="admin-loading">Opening the control room...</div>}
      {error && <AdminDenied title="Control room unavailable" body={error} action={<button className="button button--ghost" onClick={() => void load()}>Try again</button>} />}
      {!loading && !error && overview && settings && <>
        {tab === 'overview' && <OverviewPanel overview={overview} audit={audit} />}
        {tab === 'discord' && <DiscordPanel settings={settings} roleResolution={roleResolution} onSaved={(next) => { setSettings(next); void load(); }} />}
        {tab === 'coda' && <CodaDiscordPanel />}
        {tab === 'access' && <AccessPanel settings={settings} />}
        {tab === 'system' && <SystemPanel overview={overview} settings={settings} />}
      </>}
    </AdminFrame>
  );
}

function AdminFrame({ children }: { children: React.ReactNode }) {
  return <div className="page admin-page"><header className="admin-header"><span className="admin-header__seal"><ServerCog /></span><div><span className="eyebrow">Protected administration</span><h1>Orbis control room</h1><p>Library configuration, access policy and operational status.</p></div></header>{children}</div>;
}

function AdminDenied({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <section className="admin-denied"><ShieldCheck /><h2>{title}</h2><p>{body}</p>{action}</section>;
}

function OverviewPanel({ overview, audit }: { overview: AdminOverview; audit: AdminAuditEntry[] }) {
  const labels: Record<keyof AdminOverview['status'], string> = {
    apiOnline: 'API online', databaseConnected: 'Database connected', discordOAuthConfigured: 'Discord OAuth',
    discordGuildConfigured: 'Discord guild', adultPolicyConfigured: 'Adult policy', creatorPolicyConfigured: 'Creator policy',
    adminPolicyConfigured: 'Admin recovery', inviteUrlConfigured: 'Website invite', codaDiscordConfigured: 'Coda Discord sender',
  };
  return <div className="admin-stack"><section className="admin-section"><div className="admin-section__title"><Activity /><div><h2>Operational overview</h2><p>Current health and configuration readiness.</p></div></div><div className="status-grid">{Object.entries(overview.status).map(([key, value]) => <div className={`status-card ${value ? 'is-ready' : 'is-missing'}`} key={key}><span /><strong>{labels[key as keyof typeof labels]}</strong><small>{value ? 'Ready' : 'Needs configuration'}</small></div>)}</div></section><AuditPanel audit={audit} /></div>;
}

function DiscordPanel({ settings, roleResolution, onSaved }: { settings: AdminSettings; roleResolution: string; onSaved: (settings: AdminSettings) => void }) {
  const initial = useMemo(() => ({ guildId: settings.guildId, adultRoleIds: joinIds(settings.adultRoleIds), creatorRoleIds: joinIds(settings.creatorRoleIds), adminRoleIds: joinIds(settings.adminRoleIds), inviteUrl: settings.inviteUrl }), [settings]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => setForm(initial), [initial]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage('');
    const payload: EditableSettings = { guildId: form.guildId.trim(), adultRoleIds: splitIds(form.adultRoleIds), creatorRoleIds: splitIds(form.creatorRoleIds), adminRoleIds: splitIds(form.adminRoleIds), inviteUrl: form.inviteUrl.trim() };
    try { const result = await adminApi.updateSettings(payload); onSaved(result.settings); setMessage('Orbis settings saved and audited.'); }
    catch (saveError) { setMessage(saveError instanceof Error ? saveError.message : 'Settings could not be saved.'); }
    finally { setSaving(false); }
  };
  return <section className="admin-section"><div className="admin-section__title"><Settings2 /><div><h2>Discord settings</h2><p>Exact Discord IDs are authoritative. Role names are never used for permission checks.</p></div></div><form className="admin-form" onSubmit={save}><AdminField label="Guild/server ID" source={settings.sources.guildId}><input value={form.guildId} onChange={(event) => setForm({ ...form, guildId: event.target.value })} placeholder="1544909655275208716" inputMode="numeric" /></AdminField><AdminField label="Adult Access role IDs" source={settings.sources.adultRoleIds} hint="One exact role ID per line."><textarea value={form.adultRoleIds} onChange={(event) => setForm({ ...form, adultRoleIds: event.target.value })} rows={4} /></AdminField><AdminField label="Creator role IDs" source={settings.sources.creatorRoleIds} hint="Leave empty to use Adult Access roles."><textarea value={form.creatorRoleIds} onChange={(event) => setForm({ ...form, creatorRoleIds: event.target.value })} rows={4} /></AdminField>{splitIds(form.creatorRoleIds).length === 0 && <div className="policy-notice">Creator access currently falls back to Adult Access roles.</div>}<AdminField label="Orbis administrator role IDs" source={settings.sources.adminRoleIds} hint="Administration does not grant adult access."><textarea value={form.adminRoleIds} onChange={(event) => setForm({ ...form, adminRoleIds: event.target.value })} rows={4} /></AdminField><AdminField label="Website Discord invite URL" source={settings.sources.inviteUrl}><input value={form.inviteUrl} onChange={(event) => setForm({ ...form, inviteUrl: event.target.value })} placeholder="https://discord.gg/..." /></AdminField><p className="admin-resolution">{roleResolution}</p><div className="admin-form__footer"><span role="status">{message}</span><button className="button button--primary" disabled={saving}><Save size={16} /> {saving ? 'Saving...' : 'Save configuration'}</button></div></form></section>;
}

function AdminField({ label, hint, source, children }: { label: string; hint?: string; source: string; children: React.ReactNode }) {
  return <label className="admin-field"><span><strong>{label}</strong><small className={`source-badge source-${source}`}>{source}</small></span>{children}{hint && <small>{hint}</small>}</label>;
}

function AccessPanel({ settings }: { settings: AdminSettings }) {
  return <div className="admin-stack"><section className="admin-section"><div className="admin-section__title"><UsersRound /><div><h2>Role capability map</h2><p>Capabilities remain separate. Staff roles never become adult roles automatically.</p></div></div><div className="capability-grid"><Capability title="Orbis administration" ids={settings.adminRoleIds} extra={settings.bootstrapAdminRoleIds} note="Editable admin roles plus protected recovery roles." /><Capability title="Adult viewing" ids={settings.adultRoleIds} note="Only these roles reveal adult-rated records." /><Capability title="Creation access" ids={settings.effectiveCreatorRoleIds} note={settings.creatorUsesAdultFallback ? 'Creator access currently falls back to Adult Access roles.' : 'Creators must also hold an Adult Access role.'} /></div></section></div>;
}

function Capability({ title, ids, extra = [], note }: { title: string; ids: string[]; extra?: string[]; note: string }) {
  return <article className="capability-card"><ShieldCheck /><h3>{title}</h3><p>{note}</p><div className="role-id-list">{ids.map((id) => <code key={id}>{id}</code>)}{extra.map((id) => <code className="is-bootstrap" key={id}>{id} · recovery</code>)}{ids.length + extra.length === 0 && <em>Not configured</em>}</div></article>;
}

function CodaDiscordPanel() {
  type CodaSubTab = 'channels' | 'dm' | 'templates' | 'schedule' | 'history' | 'status';
  const [subTab, setSubTab] = useState<CodaSubTab>('channels');
  const [channels, setChannels] = useState<AdminCodaChannel[]>([]);
  const [history, setHistory] = useState<AdminCodaMessage[]>([]);
  const [templates, setTemplates] = useState<AdminCodaTemplate[]>([]);
  const [scheduled, setScheduled] = useState<AdminCodaScheduled[]>([]);
  const [status, setStatus] = useState<AdminCodaStatus>();
  const [configured, setConfigured] = useState<boolean>();
  const [configurationReason, setConfigurationReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const [channelId, setChannelId] = useState('');
  const [channelContent, setChannelContent] = useState('');
  const [replyTo, setReplyTo] = useState('');

  const [memberQuery, setMemberQuery] = useState('');
  const [members, setMembers] = useState<AdminCodaMember[]>([]);
  const [recipient, setRecipient] = useState('');
  const [dmContent, setDmContent] = useState('');

  const [templateName, setTemplateName] = useState('');
  const [templateContent, setTemplateContent] = useState('');

  const [scheduleType, setScheduleType] = useState<'channel' | 'dm'>('channel');
  const [scheduleTarget, setScheduleTarget] = useState('');
  const [scheduleContent, setScheduleContent] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [channelState, messageState, templateState, scheduledState, statusState] = await Promise.all([
        adminApi.codaChannels(), adminApi.codaMessages(), adminApi.codaTemplates(), adminApi.codaScheduled(), adminApi.codaStatus(),
      ]);
      setChannels(channelState.items); setConfigured(channelState.configured); setConfigurationReason(channelState.reason ?? '');
      setHistory(messageState.items); setTemplates(templateState.items); setScheduled(scheduledState.items); setStatus(statusState);
      setChannelId((current) => current && channelState.items.some((channel) => channel.id === current) ? current : channelState.items[0]?.id ?? '');
      setScheduleTarget((current) => current || channelState.items[0]?.id || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Coda command center could not be loaded.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refreshHistory = async () => setHistory((await adminApi.codaMessages()).items);
  const useTemplate = (template: AdminCodaTemplate, destination: 'channel' | 'dm' | 'schedule') => {
    if (destination === 'channel') { setChannelContent(template.content); setSubTab('channels'); }
    if (destination === 'dm') { setDmContent(template.content); setSubTab('dm'); }
    if (destination === 'schedule') { setScheduleContent(template.content); setSubTab('schedule'); }
  };

  const sendChannel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!channelId || !channelContent.trim() || channelContent.length > channelLimit) { overLimit(channelContent, channelLimit, 'This channel message'); return; }
    setWorking(true); setNotice(''); setError('');
    try {
      const result = await adminApi.sendCodaMessage({ channelId, content: channelContent, ...(replyTo.trim() ? { replyTo: replyTo.trim() } : {}) });
      setNotice(result.partCount > 1 ? `Coda posted ${result.partCount} sequential messages to Discord.` : 'Coda posted the message to Discord.');
      setChannelContent(''); setReplyTo('');
      setHistory((current) => [...result.messages, ...current].slice(0, 50));
    } catch (sendError) { setError(sendError instanceof Error ? sendError.message : 'Coda could not post that message.'); }
    finally { setWorking(false); }
  };

  const searchMembers = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!memberQuery.trim()) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const result = await adminApi.codaMembers(memberQuery);
      setMembers(result.items);
      if (result.items.length === 1) setRecipient(result.items[0].id);
      if (result.items.length === 0) setNotice('No matching Discord members found. You can still use an exact user ID.');
    } catch (searchError) { setError(searchError instanceof Error ? searchError.message : 'Coda could not search members.'); }
    finally { setWorking(false); }
  };

  const sendDm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!recipient.trim() || !dmContent.trim() || dmContent.length > dmLimit) { overLimit(dmContent, dmLimit, 'This private message'); return; }
    setWorking(true); setNotice(''); setError('');
    try {
      const result = await adminApi.sendCodaDm({ recipient: recipient.trim(), content: dmContent });
      setNotice(result.partCount > 1 ? `Coda delivered ${result.partCount} sequential private messages.` : 'Private message delivered by Coda.');
      setDmContent('');
      setHistory((current) => [...result.messages, ...current].slice(0, 50));
    } catch (sendError) { setError(sendError instanceof Error ? sendError.message : 'Coda could not send that private message.'); }
    finally { setWorking(false); }
  };

  const createTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!templateName.trim() || !templateContent.trim()) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const result = await adminApi.createCodaTemplate({ name: templateName, content: templateContent });
      setTemplates((current) => [...current, result.item].sort((a, b) => a.name.localeCompare(b.name)));
      setTemplateName(''); setTemplateContent(''); setNotice('Template saved.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Template could not be saved.'); }
    finally { setWorking(false); }
  };

  const scheduleMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    const target = scheduleType === 'channel' ? scheduleTarget : scheduleTarget.trim();
    if (!target || !scheduleContent.trim() || !scheduleAt) return;
    if (scheduleContent.length > channelLimit) { overLimit(scheduleContent, channelLimit, 'This scheduled message'); return; }
    setWorking(true); setError(''); setNotice('');
    try {
      const result = await adminApi.scheduleCodaMessage({
        destinationType: scheduleType, targetId: target, content: scheduleContent,
        sendAt: new Date(scheduleAt).toISOString(), ...(scheduleType === 'channel' && replyTo.trim() ? { replyTo: replyTo.trim() } : {}),
      });
      setScheduled((current) => [result.item, ...current]); setScheduleContent(''); setNotice('Coda queued the message.');
    } catch (scheduleError) { setError(scheduleError instanceof Error ? scheduleError.message : 'Coda could not schedule that message.'); }
    finally { setWorking(false); }
  };

  const editHistory = async (item: AdminCodaMessage) => {
    const next = window.prompt('Edit Coda message', item.content);
    if (next === null || !next.trim() || next === item.content) return;
    setWorking(true); setError('');
    try { await adminApi.editCodaMessage(item.id, next); await refreshHistory(); setNotice('Coda message edited.'); }
    catch (editError) { setError(editError instanceof Error ? editError.message : 'Message could not be edited.'); }
    finally { setWorking(false); }
  };

  const deleteHistory = async (item: AdminCodaMessage) => {
    if (!window.confirm('Delete this message from Discord?')) return;
    setWorking(true); setError('');
    try { await adminApi.deleteCodaMessage(item.id); await refreshHistory(); setNotice('Coda message deleted from Discord.'); }
    catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Message could not be deleted.'); }
    finally { setWorking(false); }
  };

  const channelNames = useMemo(() => new Map(channels.map((channel) => [channel.id, channel.name])), [channels]);
  const splitEnabled = status?.splitLongMessages !== false;
  const channelLimit = splitEnabled ? CODA_COMPOSED_MAX_LENGTH : CODA_MESSAGE_MAX_LENGTH;
  const dmLimit = channelLimit;
  const templateLimit = channelLimit;
  const channelParts = useMemo(() => codaMessagePartCount(channelContent, splitEnabled), [channelContent, splitEnabled]);
  const dmParts = useMemo(() => codaMessagePartCount(dmContent, splitEnabled), [dmContent, splitEnabled]);
  const scheduleParts = useMemo(() => codaMessagePartCount(scheduleContent, splitEnabled), [scheduleContent, splitEnabled]);
  const overLimit = (value: string, limit: number, label: string) => {
    if (value.trim() && value.length > limit) setError(`${label} is ${value.length} characters. The limit is ${limit}.`);
  };
  const subTabs: Array<{ id: CodaSubTab; label: string; icon: React.ReactNode }> = [
    { id: 'channels', label: 'Channels', icon: <MessageSquareText size={15} /> },
    { id: 'dm', label: 'Private DMs', icon: <MessageCircle size={15} /> },
    { id: 'templates', label: 'Templates', icon: <BookOpen size={15} /> },
    { id: 'schedule', label: 'Schedule', icon: <Clock size={15} /> },
    { id: 'history', label: 'History', icon: <History size={15} /> },
    { id: 'status', label: 'Status', icon: <Wifi size={15} /> },
  ];

  return <div className="admin-stack coda-hub">
    <section className="admin-section coda-hub__header">
      <div className="admin-section__title"><MessageSquareText /><div><h2>Coda command center</h2><p>Speak in channels, send private messages, keep templates, schedule deliveries and control Coda's outbound access.</p></div></div>
      <nav className="coda-subtabs" aria-label="Coda controls">{subTabs.map((item) => <button key={item.id} className={subTab === item.id ? 'is-active' : ''} onClick={() => { setSubTab(item.id); setError(''); setNotice(''); }}>{item.icon}{item.label}</button>)}</nav>
      {loading && <div className="coda-console-status">Waking Coda's command desk...</div>}
      {!loading && error && <div className="policy-notice coda-console-error">{error}</div>}
      {!loading && notice && <div className="coda-console-notice">{notice}</div>}
      {!loading && status && !status.outboundEnabled && <div className="coda-kennel-banner"><Power size={17} /><span><strong>Coda is in the kennel.</strong> Outbound channel posts, DMs and scheduled deliveries are paused.</span></div>}
    </section>

    {!loading && subTab === 'channels' && <section className="admin-section">
      <div className="admin-section__title"><MessageSquareText /><div><h2>Speak in Discord</h2><p>Send a public server message through Coda. Every text and announcement channel the Coda bot can see is listed.</p></div></div>
      {configured === false ? <div className="policy-notice">{configurationReason || 'Configure Coda on the Orbis server.'}</div> : <div className="coda-console">
        <form className="coda-console__composer" onSubmit={sendChannel}>
          <label className="admin-field"><span><strong>Discord channel</strong><small className="coda-count">{channels.length} channel{channels.length === 1 ? '' : 's'} Coda can post in</small></span><ChannelSelect channels={channels} value={channelId} onChange={setChannelId} /></label>
          <TemplatePicker templates={templates} onUse={(template) => setChannelContent(template.content)} />
          <label className="admin-field"><span><strong>Message as Coda</strong><small className={channelContent.length > channelLimit ? 'coda-count is-over' : 'coda-count'}>{channelContent.length}/{channelLimit}{channelParts > 1 ? ` · ${channelParts} parts` : ''}</small></span><textarea value={channelContent} onChange={(event) => setChannelContent(event.target.value)} rows={10} placeholder="Paste exactly what Coda should say..." /></label>
          <label className="admin-field"><span><strong>Reply to message</strong></span><input value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="Optional Discord message link or message ID" /><small>The reply must be in the selected channel.</small></label>
          <div className="coda-console__actions"><span /><button type="button" className="button button--ghost" onClick={() => void load()} disabled={working}><RefreshCw size={16} /> Refresh</button><button className="button button--primary" disabled={working || !status?.outboundEnabled || !channelId || !channelContent.trim() || channelContent.length > channelLimit}><Send size={16} /> {working ? 'Sending...' : channelParts > 1 ? `Send as ${channelParts} messages` : 'Send as Coda'}</button></div>
        </form>
        <CodaPreview content={channelContent} />
      </div>}
    </section>}

    {!loading && subTab === 'dm' && <section className="admin-section">
      <div className="admin-section__title"><MessageCircle /><div><h2>Private courier</h2><p>Tell Coda who to bother privately. Search the server or paste an exact Discord user ID/mention.</p></div></div>
      <div className="coda-dm-layout">
        <form className="coda-console__composer" onSubmit={sendDm}>
          <form className="coda-member-search" onSubmit={searchMembers}><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search David Silver, username, ID..." /><button type="submit" className="button button--ghost" disabled={working}><Search size={16} /> Find</button></form>
          {members.length > 0 && <div className="coda-member-results">{members.map((member) => <button type="button" key={member.id} className={recipient === member.id ? 'is-selected' : ''} onClick={() => setRecipient(member.id)}><User size={16} /><span><strong>{member.displayName}</strong><small>@{member.username} · {member.id}{member.bot ? ' · bot' : ''}</small></span></button>)}</div>}
          <label className="admin-field"><span><strong>Recipient</strong></span><input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="Discord user ID or <@mention>" /></label>
          <TemplatePicker templates={templates} onUse={(template) => setDmContent(template.content)} />
          <label className="admin-field"><span><strong>Private message</strong><small className={dmContent.length > dmLimit ? 'coda-count is-over' : 'coda-count'}>{dmContent.length}/{dmLimit}{dmParts > 1 ? ` · ${dmParts} parts` : ''}</small></span><textarea value={dmContent} onChange={(event) => setDmContent(event.target.value)} rows={9} placeholder="What should Coda whisper to them?" /></label>
          <div className="coda-console__actions"><span /><button className="button button--primary" disabled={working || !status?.outboundEnabled || !recipient.trim() || !dmContent.trim() || dmContent.length > dmLimit}><Send size={16} /> {working ? 'Delivering...' : dmParts > 1 ? `Deliver ${dmParts} messages` : 'Send private DM'}</button></div>
        </form>
        <CodaPreview content={dmContent} privateMessage />
      </div>
    </section>}

    {!loading && subTab === 'templates' && <section className="admin-section">
      <div className="admin-section__title"><BookOpen /><div><h2>Coda message templates</h2><p>Keep reusable welcomes, notices and recurring messages without retyping them.</p></div></div>
      <div className="coda-template-layout">
        <form className="coda-console__composer" onSubmit={createTemplate}>
          <label className="admin-field"><span><strong>Template name</strong></span><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Welcome new member" /></label>
          <label className="admin-field"><span><strong>Message</strong><small className={templateContent.length > templateLimit ? 'coda-count is-over' : 'coda-count'}>{templateContent.length}/{templateLimit}</small></span><textarea value={templateContent} onChange={(event) => setTemplateContent(event.target.value)} rows={8} /></label>
          <div className="coda-console__actions"><span /><button className="button button--primary" disabled={working || !templateName.trim() || !templateContent.trim() || templateContent.length > templateLimit}><Save size={16} /> Save template</button></div>
        </form>
        <div className="coda-template-list">{templates.length === 0 && <p className="admin-empty">No templates yet.</p>}{templates.map((template) => <article key={template.id}><header><strong>{template.name}</strong><button className="icon-button danger" title="Delete template" onClick={async () => { if (!window.confirm('Delete this Coda template?')) return; setWorking(true); try { await adminApi.deleteCodaTemplate(template.id); setTemplates((current) => current.filter((item) => item.id !== template.id)); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Template could not be deleted.'); } finally { setWorking(false); } }}><Trash2 size={15} /></button></header><p>{template.content}</p><div><button onClick={() => useTemplate(template, 'channel')}>Use in channel</button><button onClick={() => useTemplate(template, 'dm')}>Use in DM</button><button onClick={() => useTemplate(template, 'schedule')}>Schedule it</button></div></article>)}</div>
      </div>
    </section>}

    {!loading && subTab === 'schedule' && <section className="admin-section">
      <div className="admin-section__title"><Clock /><div><h2>Scheduled delivery</h2><p>Queue a channel post or private DM. The Orbis service checks the queue every 30 seconds.</p></div></div>
      <div className="coda-schedule-layout">
        <form className="coda-console__composer" onSubmit={scheduleMessage}>
          <label className="admin-field"><span><strong>Destination</strong></span><select value={scheduleType} onChange={(event) => { const next = event.target.value as 'channel' | 'dm'; setScheduleType(next); setScheduleTarget(next === 'channel' ? channels[0]?.id ?? '' : ''); }}><option value="channel">Discord channel</option><option value="dm">Private DM</option></select></label>
          {scheduleType === 'channel' ? <label className="admin-field"><span><strong>Channel</strong><small className="coda-count">{channels.length} available</small></span><ChannelSelect channels={channels} value={scheduleTarget} onChange={setScheduleTarget} /></label> : <label className="admin-field"><span><strong>Discord user ID</strong></span><input value={scheduleTarget} onChange={(event) => setScheduleTarget(event.target.value)} placeholder="123456789012345678" /></label>}
          <TemplatePicker templates={templates} onUse={(template) => setScheduleContent(template.content)} />
          <label className="admin-field"><span><strong>Message</strong><small className={scheduleContent.length > channelLimit ? 'coda-count is-over' : 'coda-count'}>{scheduleContent.length}/{channelLimit}{scheduleParts > 1 ? ` · ${scheduleParts} parts at delivery` : ''}</small></span><textarea value={scheduleContent} onChange={(event) => setScheduleContent(event.target.value)} rows={7} /></label>
          <label className="admin-field"><span><strong>Send at</strong></span><input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /></label>
          <div className="coda-console__actions"><span /><button className="button button--primary" disabled={working || !scheduleTarget || !scheduleContent.trim() || !scheduleAt}><Clock size={16} /> Queue message</button></div>
        </form>
        <div className="coda-scheduled-list">{scheduled.length === 0 && <p className="admin-empty">Nothing scheduled.</p>}{scheduled.map((item) => <article key={item.id} className={'status-' + item.status}><header><strong>{item.destinationType === 'channel' ? '#' + (channelNames.get(item.targetId) ?? item.targetId) : 'DM · ' + item.targetId}</strong><span>{item.status}</span></header><p>{item.content}</p><small>{new Date(item.sendAt).toLocaleString()} · {item.createdByName ?? 'administrator'}</small>{item.lastError && <em>{item.lastError}</em>}{item.status === 'queued' && <button className="button button--ghost" onClick={async () => { setWorking(true); try { await adminApi.cancelCodaScheduled(item.id); setScheduled((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'cancelled' } : entry)); } catch (cancelError) { setError(cancelError instanceof Error ? cancelError.message : 'Scheduled message could not be cancelled.'); } finally { setWorking(false); } }}>Cancel</button>}</article>)}</div>
      </div>
    </section>}

    {!loading && subTab === 'history' && <section className="admin-section">
      <div className="admin-section__title"><History /><div><h2>Message history</h2><p>Everything sent from the Orbis Coda desk, including private deliveries and failures.</p></div></div>
      <div className="coda-message-history">{history.length === 0 && <p className="admin-empty">No Coda messages have been sent from Orbis yet.</p>}{history.map((item) => <article key={item.id} className={item.status === 'failed' ? 'is-failed' : item.deletedAt ? 'is-deleted' : ''}><header><strong>{item.destinationType === 'dm' ? 'DM → ' + (item.recipientDisplayName ?? item.recipientUserId ?? 'unknown') : '#' + (channelNames.get(item.channelId) ?? item.channelId)}</strong><span>{item.deletedAt ? 'deleted' : item.status}</span></header><p>{item.content}</p><small>{item.sentByName ?? 'Unknown administrator'} · {new Date(item.createdAt).toLocaleString()}{item.editedAt ? ' · edited' : ''}</small>{item.errorMessage && <em>{item.errorMessage}</em>}{item.status === 'sent' && !item.deletedAt && <div className="coda-history-actions"><button className="button button--ghost" disabled={working} onClick={() => void editHistory(item)}><Pencil size={14} /> Edit</button><button className="button button--ghost" disabled={working} onClick={() => void deleteHistory(item)}><Trash2 size={14} /> Delete</button></div>}</article>)}</div>
    </section>}

    {!loading && subTab === 'status' && <section className="admin-section">
      <div className="admin-section__title"><Wifi /><div><h2>Coda status & safety</h2><p>Live Discord identity, queue health and the emergency outbound switch.</p></div></div>
      {status && <div className="coda-status-grid">
        <article><span>Discord identity</span><strong>{status.bot?.globalName || status.bot?.username || 'Not connected'}</strong><small>{status.bot ? '@' + status.bot.username + ' · ' + status.bot.id : 'Bot token not verified'}</small></article>
        <article><span>Server</span><strong>{status.guild?.name || 'Not resolved'}</strong><small>{status.guild?.id || 'No guild information'}</small></article>
        <article><span>Channels Coda can post in</span><strong>{status.postableChannelCount}</strong><small>{status.allowedChannelCount} pinned in CODA_DISCORD_CHANNEL_IDS (★)</small></article>
        <article><span>Queued deliveries</span><strong>{status.queuedScheduled}</strong><small>{status.lastMessageAt ? 'Last send ' + new Date(status.lastMessageAt).toLocaleString() : 'No sends recorded yet'}</small></article>
        <article><span>Discord message limit</span><strong>{status.maxMessageLength}</strong><small>Boosted guild limit per message</small></article>
        <article><span>Composed message limit</span><strong>{status.maxComposedLength}</strong><small>Longest text Orbis stores for one message</small></article>
      </div>}
      {status && <div className="coda-kill-switch is-live"><div><Scissors size={20} /><span><strong>{status.splitLongMessages ? 'Long messages split into parts' : 'Long messages refused'}</strong><small>{status.splitLongMessages ? `Anything over ${status.maxMessageLength} characters is posted as sequential messages, splitting on blank lines, then lines, then spaces. Only the first part carries the reply.` : `Messages over ${status.maxMessageLength} characters are rejected. Raise the limit or switch splitting on.`}</small></span></div><button className="button button--ghost" disabled={working} onClick={async () => { setWorking(true); setError(''); try { const result = await adminApi.setCodaOutbound(status.outboundEnabled, !status.splitLongMessages); setStatus({ ...status, splitLongMessages: result.splitLongMessages }); setNotice(result.splitLongMessages ? 'Coda will split long messages into parts.' : 'Coda will refuse messages longer than one Discord post.'); } catch (controlError) { setError(controlError instanceof Error ? controlError.message : 'Coda splitting could not be changed.'); } finally { setWorking(false); } }}>{status.splitLongMessages ? 'Stop splitting' : 'Split long messages'}</button></div>}
      <div className={'coda-kill-switch ' + (status?.outboundEnabled ? 'is-live' : 'is-stopped')}><div><Power /><span><strong>{status?.outboundEnabled ? 'Outbound messaging enabled' : 'Coda is in the kennel'}</strong><small>This switch blocks channel posts, DMs, edits/deletes and pauses scheduled deliveries.</small></span></div><button className={'button ' + (status?.outboundEnabled ? 'button--ghost' : 'button--primary')} disabled={working || !status} onClick={async () => { if (!status) return; if (status.outboundEnabled && !window.confirm('Put Coda in the kennel and stop all outbound Discord actions?')) return; setWorking(true); try { const result = await adminApi.setCodaOutbound(!status.outboundEnabled); setStatus({ ...status, outboundEnabled: result.outboundEnabled }); setNotice(result.outboundEnabled ? 'Coda is back out of the kennel.' : 'Coda is safely in the kennel.'); } catch (controlError) { setError(controlError instanceof Error ? controlError.message : 'Coda control could not be changed.'); } finally { setWorking(false); } }}>{status?.outboundEnabled ? 'PUT CODA IN HER KENNEL' : 'Release Coda'}</button></div>
    </section>}
  </div>;
}

function ChannelSelect({ channels, value, onChange }: { channels: AdminCodaChannel[]; value: string; onChange: (value: string) => void }) {
  const groups = [...new Set(channels.map((channel) => channel.parentName ?? ''))];
  return <select value={value} onChange={(event) => onChange(event.target.value)}>
    {groups.map((group) => <optgroup key={group || 'other'} label={group || 'Other channels'}>
      {channels.filter((channel) => (channel.parentName ?? '') === group).map((channel) => (
        <option key={channel.id} value={channel.id}>#{channel.name}{channel.type === 5 ? ' (announcement)' : ''}{channel.allowlisted ? ' ★' : ''}</option>
      ))}
    </optgroup>)}
  </select>;
}

function TemplatePicker({ templates, onUse }: { templates: AdminCodaTemplate[]; onUse: (template: AdminCodaTemplate) => void }) {
  if (templates.length === 0) return null;
  return <label className="admin-field"><span><strong>Quick template</strong></span><select defaultValue="" onChange={(event) => { const template = templates.find((item) => item.id === event.target.value); if (template) onUse(template); event.target.value = ''; }}><option value="">Choose a saved template...</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>;
}

function CodaPreview({ content, privateMessage = false }: { content: string; privateMessage?: boolean }) {
  return <aside className="coda-console__preview" aria-label="Coda message preview"><span className="coda-preview-label">{privateMessage ? 'Private preview' : 'Preview'}</span><div className="coda-preview-message"><div className="coda-preview-avatar">C</div><div><strong>Coda <small>APP</small></strong><pre>{content || (privateMessage ? 'Coda will whisper your message here.' : 'Your message will appear here.')}</pre></div></div><p>Discord applies its normal Markdown formatting after delivery.</p></aside>;
}

function SystemPanel({ overview, settings }: { overview: AdminOverview; settings: AdminSettings }) {
  return <div className="admin-stack"><section className="admin-section"><div className="admin-section__title"><Database /><div><h2>System information</h2><p>Read-only status. Secret values are never returned.</p></div></div><dl className="system-list"><div><dt>Orbis version</dt><dd>{overview.system.version}</dd></div><div><dt>Build commit</dt><dd>{overview.system.buildSha ?? 'Not supplied'}</dd></div><div><dt>Environment</dt><dd>{overview.system.environment}</dd></div><div><dt>Database</dt><dd>{overview.status.databaseConnected ? 'Connected' : 'Unavailable'}</dd></div><div><dt>Database URL</dt><dd>{overview.secrets.databaseUrl === 'configured' ? 'Configured' : 'Missing'}</dd></div><div><dt>Session secret</dt><dd>{overview.secrets.sessionSecret === 'configured' ? 'Configured' : 'Missing'}</dd></div><div><dt>Discord client secret</dt><dd>{overview.secrets.discordClientSecret === 'configured' ? 'Configured' : 'Missing'}</dd></div><div><dt>Coda bot token</dt><dd>{overview.secrets.codaDiscordBotToken === 'configured' ? 'Configured' : 'Missing'}</dd></div><div><dt>Creator fallback</dt><dd>{settings.creatorUsesAdultFallback ? 'Adult Access roles' : 'Disabled'}</dd></div></dl></section></div>;
}

function AuditPanel({ audit }: { audit: AdminAuditEntry[] }) {
  return <section className="admin-section"><div className="admin-section__title"><History /><div><h2>Recent configuration changes</h2><p>Non-secret settings changes recorded by Orbis.</p></div></div><div className="audit-list">{audit.length === 0 && <p className="admin-empty">No administrative changes recorded yet.</p>}{audit.map((entry) => <div key={entry.id}><KeyRound /><span><strong>{entry.settingKey}</strong><small>{entry.changedByName ?? 'Unknown administrator'} · {new Date(entry.changedAt).toLocaleString()}</small></span></div>)}</div></section>;
}
