import { Activity, Database, History, KeyRound, Save, ServerCog, Settings2, ShieldCheck, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi, type AdminAuditEntry, type AdminOverview, type AdminSettings } from '../admin/api';
import { discordLoginPath, useAuth } from '../auth/AuthContext';

type AdminTab = 'overview' | 'discord' | 'access' | 'system';
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
        {(['overview', 'discord', 'access', 'system'] as AdminTab[]).map((item) => <button key={item} className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{item}</button>)}
      </nav>
      {loading && <div className="admin-loading">Opening the control room...</div>}
      {error && <AdminDenied title="Control room unavailable" body={error} action={<button className="button button--ghost" onClick={() => void load()}>Try again</button>} />}
      {!loading && !error && overview && settings && <>
        {tab === 'overview' && <OverviewPanel overview={overview} audit={audit} />}
        {tab === 'discord' && <DiscordPanel settings={settings} roleResolution={roleResolution} onSaved={(next) => { setSettings(next); void load(); }} />}
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
    adminPolicyConfigured: 'Admin recovery', inviteUrlConfigured: 'Website invite',
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

function SystemPanel({ overview, settings }: { overview: AdminOverview; settings: AdminSettings }) {
  return <div className="admin-stack"><section className="admin-section"><div className="admin-section__title"><Database /><div><h2>System information</h2><p>Read-only status. Secret values are never returned.</p></div></div><dl className="system-list"><div><dt>Orbis version</dt><dd>{overview.system.version}</dd></div><div><dt>Build commit</dt><dd>{overview.system.buildSha ?? 'Not supplied'}</dd></div><div><dt>Environment</dt><dd>{overview.system.environment}</dd></div><div><dt>Database</dt><dd>{overview.status.databaseConnected ? 'Connected' : 'Unavailable'}</dd></div><div><dt>Database URL</dt><dd>{overview.secrets.databaseUrl === 'configured' ? 'Configured' : 'Missing'}</dd></div><div><dt>Session secret</dt><dd>{overview.secrets.sessionSecret === 'configured' ? 'Configured' : 'Missing'}</dd></div><div><dt>Discord client secret</dt><dd>{overview.secrets.discordClientSecret === 'configured' ? 'Configured' : 'Missing'}</dd></div><div><dt>Creator fallback</dt><dd>{settings.creatorUsesAdultFallback ? 'Adult Access roles' : 'Disabled'}</dd></div></dl></section></div>;
}

function AuditPanel({ audit }: { audit: AdminAuditEntry[] }) {
  return <section className="admin-section"><div className="admin-section__title"><History /><div><h2>Recent configuration changes</h2><p>Non-secret settings changes recorded by Orbis.</p></div></div><div className="audit-list">{audit.length === 0 && <p className="admin-empty">No administrative changes recorded yet.</p>}{audit.map((entry) => <div key={entry.id}><KeyRound /><span><strong>{entry.settingKey}</strong><small>{entry.changedByName ?? 'Unknown administrator'} · {new Date(entry.changedAt).toLocaleString()}</small></span></div>)}</div></section>;
}
