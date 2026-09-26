import { BookOpen, Search, Send, Sparkles, WandSparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { askCoda, CodaAssistantError, type CodaAssistantResponse, type CodaHistoryTurn, type CodaMode, type CodaProposal } from '../api/coda-assistant';
import { libraryApi } from '../api/client';
import type { ContentRating } from '../types/library';
import { useAuth } from '../auth/AuthContext';

const modes: Array<{ id: CodaMode; label: string; icon: typeof BookOpen; hint: string; placeholder: string }> = [
  { id: 'guide', label: 'Ask', icon: BookOpen, hint: 'Explain Orbis or Speculus.', placeholder: 'What are you trying to understand?' },
  { id: 'sort', label: 'Sort', icon: WandSparkles, hint: 'Turn messy lore into reviewable structure.', placeholder: 'Paste lore, notes, a character bio, or world text...' },
  { id: 'inspect', label: 'Inspect', icon: Search, hint: 'Sniff out repetition and inconsistencies.', placeholder: 'Paste the output, log, or text that feels wrong...' },
];

function currentAssetId(pathname: string) {
  return pathname.match(/^\/asset\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
}

function pageHint(pathname: string) {
  if (pathname === '/') return 'Orbis home';
  if (pathname === '/account') return 'Account settings';
  if (pathname === '/admin') return 'Administration';
  if (/^\/asset\/[0-9a-f-]{36}\/edit$/i.test(pathname)) return 'Record editor';
  if (/^\/asset\/[0-9a-f-]{36}\/saves$/i.test(pathname)) return 'Save archive';
  if (/^\/asset\/[0-9a-f-]{36}(?:\/)?$/i.test(pathname)) return 'Record detail';
  const collection = pathname.match(/^\/library\/([a-z-]+)$/i)?.[1];
  if (collection) return `${collection} collection`;
  if (pathname === '/all') return 'Complete archive';
  if (pathname.startsWith('/projects/')) return 'Project information';
  return 'Orbis';
}

function proposalKey(proposal: CodaProposal, index: number) {
  return `${index}:${proposal.type}:${proposal.name.toLocaleLowerCase()}`;
}

function assistantHistoryText(result: CodaAssistantResponse) {
  if (result.mode !== 'sort') return (result.text ?? '').slice(0, 60_000);
  return JSON.stringify({
    summary: result.summary ?? '',
    proposals: result.proposals ?? [],
    questions: result.questions ?? [],
    warnings: result.warnings ?? [],
    recordPatch: result.recordPatch ?? null,
  }).slice(0, 60_000);
}

function StringList({ title, values, tone }: { title: string; values?: string[]; tone?: 'warning' }) {
  if (!values?.length) return null;
  return <section className={`coda-result-list ${tone === 'warning' ? 'is-warning' : ''}`}><strong>{title}</strong><ul>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul></section>;
}

function ProposalCard({ proposal, index, canCreate, createdId, onCreate }: {
  proposal: CodaProposal;
  index: number;
  canCreate: boolean;
  createdId?: string;
  onCreate: (proposal: CodaProposal, rating: ContentRating, index: number) => Promise<string>;
}) {
  const [rating, setRating] = useState<ContentRating>('sfw');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const create = async () => {
    if (creating || createdId) return;
    setCreating(true);
    setCreateError('');
    try {
      await onCreate(proposal, rating, index);
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : 'Coda could not create that record.');
    } finally {
      setCreating(false);
    }
  };

  return <article className="coda-proposal" key={`${proposal.type}-${proposal.name}-${index}`}>
    <header><span>{proposal.type}</span><b>{proposal.name}</b><small className={`confidence confidence--${proposal.confidence}`}>{proposal.confidence}</small></header>
    {proposal.reason && <p>{proposal.reason}</p>}
    {proposal.fields && Object.keys(proposal.fields).length > 0 && <details className="coda-field-preview"><summary>Proposed fields</summary><pre>{JSON.stringify(proposal.fields, null, 2)}</pre></details>}
    {canCreate && <div className="coda-proposal__create">
      <label><span>Rating</span><select value={rating} onChange={(event) => setRating(event.target.value as ContentRating)} disabled={creating || Boolean(createdId)}><option value="sfw">SFW</option><option value="adult">Adult</option></select></label>
      {createdId
        ? <Link className="button button--secondary" to={`/asset/${createdId}/edit`}>Open created {proposal.type}</Link>
        : <button type="button" className="button button--primary" disabled={creating} onClick={() => void create()}>{creating ? 'Creating...' : `Create ${proposal.type}`}</button>}
    </div>}
    {createError && <p className="coda-create-error" role="alert">{createError}</p>}
  </article>;
}

function SortResult({ result, canApply, canCreate, createdIds, bulkCreating, bulkMessage, onApply, onCreate, onCreateAll }: {
  result: CodaAssistantResponse;
  canApply: boolean;
  canCreate: (proposal: CodaProposal) => boolean;
  createdIds: Record<string, string>;
  bulkCreating: boolean;
  bulkMessage: string;
  onApply: () => void;
  onCreate: (proposal: CodaProposal, rating: ContentRating, index: number) => Promise<string>;
  onCreateAll: (rating: ContentRating) => Promise<void>;
}) {
  const [bulkRating, setBulkRating] = useState<ContentRating>('sfw');
  const proposals = result.proposals ?? [];
  const canBulkCreate = proposals.length > 0 && proposals.some(canCreate);

  return <div className="coda-result">
    {result.summary && <p className="coda-result__summary">{result.summary}</p>}
    {proposals.length ? <section className="coda-proposals">
      <div className="coda-proposals__heading"><strong>Proposed records</strong>{canBulkCreate && <div className="coda-finalize"><select aria-label="Create all content rating" value={bulkRating} onChange={(event) => setBulkRating(event.target.value as ContentRating)} disabled={bulkCreating}><option value="sfw">All SFW</option><option value="adult">All Adult</option></select><button type="button" className="button button--primary" disabled={bulkCreating} onClick={() => void onCreateAll(bulkRating)}>{bulkCreating ? 'Creating...' : 'Create all'}</button></div>}</div>
      {bulkMessage && <p className="coda-bulk-message" role="status">{bulkMessage}</p>}
      {proposals.map((proposal, index) => <ProposalCard proposal={proposal} index={index} canCreate={canCreate(proposal)} createdId={createdIds[proposalKey(proposal, index)]} onCreate={onCreate} key={`${proposal.type}-${proposal.name}-${index}`} />)}
    </section> : null}
    <StringList title="Needs your answer" values={result.questions} />
    <StringList title="Coda noticed" values={result.warnings} tone="warning" />
    {result.text && <pre className="coda-raw-draft">{result.text}</pre>}
    {result.recordPatch && <section className="coda-draft-ready">
      <div><strong>Current-record draft ready</strong><small>This fills the editor without overwriting authored values. Review it, then use the normal Save button.</small></div>
      <details className="coda-field-preview"><summary>Preview draft patch</summary><pre>{JSON.stringify(result.recordPatch, null, 2)}</pre></details>
      {canApply && <button type="button" className="button button--primary" onClick={onApply}>Apply draft to editor</button>}
    </section>}
  </div>;
}

export function CodaAssistant() {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CodaMode>('guide');
  const [text, setText] = useState('');
  const [includeContext, setIncludeContext] = useState(false);
  const [result, setResult] = useState<CodaAssistantResponse | null>(null);
  const [error, setError] = useState('');
  const [settingsPath, setSettingsPath] = useState('');
  const [working, setWorking] = useState(false);
  const [applied, setApplied] = useState(false);
  const [createdWorldTarget, setCreatedWorldTarget] = useState<{ id: string; name: string } | null>(null);
  const [history, setHistory] = useState<CodaHistoryTurn[]>([]);
  const [createdProposalIds, setCreatedProposalIds] = useState<Record<string, string>>({});
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');

  const assetId = useMemo(() => currentAssetId(location.pathname), [location.pathname]);
  const inEditor = Boolean(assetId && location.pathname === `/asset/${assetId}/edit`);
  const active = modes.find((item) => item.id === mode)!;

  useEffect(() => {
    setIncludeContext(false);
    setResult(null);
    setError('');
    setSettingsPath('');
    setApplied(false);
    setCreatedWorldTarget(null);
    setHistory([]);
    setCreatedProposalIds({});
    setBulkMessage('');
  }, [assetId]);

  const run = async () => {
    const input = text.trim();
    if (!input || working) return;
    setWorking(true);
    setError('');
    setSettingsPath('');
    setApplied(false);
    setCreatedProposalIds({});
    setCreatedWorldTarget(null);
    setBulkMessage('');
    try {
      const next = await askCoda({ mode, text: input, history, pageHint: pageHint(location.pathname), ...(assetId ? { assetId, includeRecordContext: includeContext } : {}) });
      setResult(next);
      setHistory((current) => [...current, { role: 'user', content: input }, { role: 'assistant', content: assistantHistoryText(next) }].slice(-8));
      setText('');
    } catch (reason) {
      if (reason instanceof CodaAssistantError) {
        setError(reason.message);
        setSettingsPath(reason.settingsPath ?? '');
      } else {
        setError(reason instanceof Error ? reason.message : 'Coda could not complete that request.');
      }
    } finally {
      setWorking(false);
    }
  };

  const applyDraft = () => {
    if (!assetId || !result?.recordPatch || result.record?.id !== assetId) return;
    window.dispatchEvent(new CustomEvent('orbis:coda-apply-draft', {
      detail: { assetId, patch: result.recordPatch },
    }));
    setApplied(true);
  };

  const createRecord = async (proposal: CodaProposal, rating: ContentRating, originWorldId: string | null) => {
    const fields = proposal.fields ?? {};
    const fieldSummary = typeof fields.summary === 'string'
      ? fields.summary
      : typeof fields.description === 'string'
        ? fields.description
        : proposal.reason ?? '';
    return libraryApi.createAsset({
      type: proposal.type,
      name: proposal.name,
      summary: fieldSummary.slice(0, 2000),
      originWorldId: proposal.type === 'world' ? null : originWorldId,
      contentRating: rating,
      tags: [],
      visualTone: 'moon',
      document: fields,
    });
  };

  const createProposal = async (proposal: CodaProposal, rating: ContentRating, index: number) => {
    if (!user?.permissions.canCreate) throw new Error('Creator access is required to create Coda proposals.');
    const key = proposalKey(proposal, index);
    const existing = createdProposalIds[key];
    if (existing) return existing;

    let originWorldId = result?.record?.canAddToWorld === true ? result.record.originWorldId ?? null : createdWorldTarget?.id ?? null;
    if (proposal.type !== 'world' && !originWorldId) {
      const worlds = (result?.proposals ?? []).map((candidate, candidateIndex) => ({ proposal: candidate, index: candidateIndex })).filter((candidate) => candidate.proposal.type === 'world');
      if (worlds.length === 1) {
        const worldKey = proposalKey(worlds[0].proposal, worlds[0].index);
        originWorldId = createdProposalIds[worldKey] ?? null;
        if (!originWorldId) {
          const world = await createRecord(worlds[0].proposal, rating, null);
          originWorldId = world.id;
          setCreatedProposalIds((current) => ({ ...current, [worldKey]: world.id }));
          setCreatedWorldTarget({ id: world.id, name: worlds[0].proposal.name });
        }
      }
    }

    const created = await createRecord(proposal, rating, originWorldId);
    setCreatedProposalIds((current) => ({ ...current, [key]: created.id }));
    if (proposal.type === 'world') setCreatedWorldTarget({ id: created.id, name: proposal.name });
    return created.id;
  };

  const createAllProposals = async (rating: ContentRating) => {
    if (!user?.permissions.canCreate || !result?.proposals?.length || bulkCreating) return;
    setBulkCreating(true);
    setBulkMessage('');
    setError('');

    const proposals = result.proposals.map((proposal, index) => ({ proposal, index, key: proposalKey(proposal, index) }));
    const createdNow: Record<string, string> = { ...createdProposalIds };
    const worldByName = new Map<string, string>();
    let createdCount = 0;
    let failedCount = 0;

    try {
      for (const entry of proposals.filter((entry) => entry.proposal.type === 'world')) {
        if (createdNow[entry.key]) {
          worldByName.set(entry.proposal.name.toLocaleLowerCase(), createdNow[entry.key]);
          continue;
        }
        try {
          const created = await createRecord(entry.proposal, rating, null);
          createdNow[entry.key] = created.id;
          worldByName.set(entry.proposal.name.toLocaleLowerCase(), created.id);
          createdCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      const contextWorldId = result.record?.canAddToWorld === true ? result.record.originWorldId : undefined;
      const onlyCreatedWorldId = worldByName.size === 1 ? [...worldByName.values()][0] : undefined;

      for (const entry of proposals.filter((entry) => entry.proposal.type !== 'world')) {
        if (createdNow[entry.key]) continue;
        const fields = entry.proposal.fields ?? {};
        const requestedWorldName = ['parentWorldName', 'worldName', 'originWorldName']
          .map((field) => typeof fields[field] === 'string' ? String(fields[field]).trim().toLocaleLowerCase() : '')
          .find(Boolean);
        const originWorldId = contextWorldId ?? (requestedWorldName ? worldByName.get(requestedWorldName) : undefined) ?? onlyCreatedWorldId ?? null;
        try {
          const created = await createRecord(entry.proposal, rating, originWorldId);
          createdNow[entry.key] = created.id;
          createdCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      setCreatedProposalIds(createdNow);
      if (!contextWorldId && worldByName.size === 1) {
        const [name, id] = [...worldByName.entries()][0];
        setCreatedWorldTarget({ id, name: proposals.find((entry) => entry.proposal.type === 'world' && entry.proposal.name.toLocaleLowerCase() === name)?.proposal.name ?? name });
      }
      setBulkMessage(failedCount ? `Created ${createdCount} record(s); ${failedCount} failed. Individual cards remain available for retry.` : `Created ${createdCount} record(s). Coda's batch is finished.`);
    } finally {
      setBulkCreating(false);
    }
  };

  const canCreateProposal = () => Boolean(user?.permissions.canCreate);

  return <>
    {open && <aside className="coda-assistant" aria-label="Coda Assistant">
      <header className="coda-assistant__header">
        <div className="coda-assistant__mark"><Sparkles size={19} /></div>
        <div><span>OVERLAY ACTIVE</span><strong>Coda Assistant</strong></div>
        <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close Coda Assistant"><X size={17} /></button>
      </header>

      <nav className="coda-mode-tabs" aria-label="Coda modes">
        {modes.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={mode === id ? 'is-active' : ''} onClick={() => { setMode(id); setResult(null); setError(''); setApplied(false); setHistory([]); setCreatedProposalIds({}); setBulkMessage(''); }}>
          <Icon size={15} /><span>{label}</span>
        </button>)}
      </nav>

      <div className="coda-assistant__body">
        <p className="coda-mode-hint">{active.hint}</p>
        {!user ? <div className="coda-notice"><strong>Coda needs an Orbis account.</strong><span>Sign in with Discord first, then she can use your configured AI provider.</span></div> : <>
          {history.length > 0 && <div className="coda-thread-status"><span>Coda remembers this thread · {Math.floor(history.length / 2)} exchange{history.length === 2 ? '' : 's'}</span><button type="button" onClick={() => { setHistory([]); setResult(null); setText(''); }}>Clear thread</button></div>}
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={history.length ? (result?.questions?.length ? 'Answer Coda here. She will remember the earlier question and your original material.' : 'Give Coda the next instruction in this thread...') : active.placeholder} rows={mode === 'sort' ? 9 : 6} />
          {assetId && <label className="coda-context-toggle">
            <input type="checkbox" checked={includeContext} onChange={(event) => setIncludeContext(event.target.checked)} />
            <span><strong>Include current record</strong><small>Off by default. Only this record is sent to your configured provider.</small></span>
          </label>}
          <button type="button" className="button button--primary coda-submit" disabled={working || !text.trim()} onClick={() => void run()}>
            <Send size={15} /> {working ? 'Coda is sniffing...' : mode === 'sort' ? 'Sort with Coda' : mode === 'inspect' ? 'Inspect with Coda' : 'Ask Coda'}
          </button>
        </>}
        {error && <div className="coda-notice is-error"><strong>{error}</strong>{settingsPath && <Link to={settingsPath}>Open Account settings</Link>}</div>}
        {result && (mode === 'sort'
          ? <SortResult
              result={result}
              canApply={Boolean(inEditor && result.record?.id === assetId)}
              canCreate={canCreateProposal}
              createdIds={createdProposalIds}
              bulkCreating={bulkCreating}
              bulkMessage={bulkMessage}
              onApply={applyDraft}
              onCreate={createProposal}
              onCreateAll={createAllProposals}
            />
          : <div className="coda-result coda-result--text"><p>{result.text}</p></div>)}
        {createdWorldTarget && mode === 'sort' && <div className="coda-notice is-success"><strong>{createdWorldTarget.name} created privately.</strong><span>Related proposals can be created inside that world; standalone proposals remain supported too.</span></div>}
        {applied && <div className="coda-notice is-success"><strong>Draft placed in the editor.</strong><span>Review the filled fields and use the normal Save button when you are satisfied.</span></div>}
      </div>

      <footer className="coda-assistant__footer">
        <span>Coda keeps this assistant thread in your browser while it is open. Create/Save actions still require your explicit click.</span>
        {result?.model && <small>{result.model}</small>}
      </footer>
    </aside>}

    <button type="button" className={`coda-launcher ${open ? 'is-open' : ''}`} onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close Coda Assistant' : 'Open Coda Assistant'}>
      <Sparkles size={20} />
      <span><strong>CODA</strong><small>{open ? 'overlay active' : 'assistant'}</small></span>
    </button>
  </>;
}
