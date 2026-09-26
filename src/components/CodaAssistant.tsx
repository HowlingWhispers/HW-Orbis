import { BookOpen, CheckCircle2, Search, Send, ShieldAlert, Sparkles, WandSparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  askCoda, CodaAssistantError, runCodaOperations, type CodaAssistantResponse, type CodaHistoryTurn,
  type CodaMode, type CodaOperation, type CodaProposal, type CodaWriteResult,
} from '../api/coda-assistant';
import type { ContentRating } from '../types/library';
import { useAuth } from '../auth/AuthContext';

const THREAD_STORAGE_KEY = 'coda.assistant.thread';
const OVERLAY_ACTIVE_CLASS = 'coda-overlay-active';

type StoredThread = {
  mode: CodaMode;
  text: string;
  history: CodaHistoryTurn[];
  result: CodaAssistantResponse | null;
  createdWorldTarget: { id: string; name: string } | null;
  createdProposalIds: Record<string, string>;
};

const emptyThread: StoredThread = { mode: 'guide', text: '', history: [], result: null, createdWorldTarget: null, createdProposalIds: {} };

function readStoredThread(): StoredThread {
  try {
    const raw = window.localStorage.getItem(THREAD_STORAGE_KEY);
    if (!raw) return emptyThread;
    const parsed = JSON.parse(raw) as Partial<StoredThread>;
    const history = Array.isArray(parsed.history)
      ? parsed.history
        .filter((turn): turn is CodaHistoryTurn => Boolean(turn) && typeof turn === 'object' && typeof (turn as CodaHistoryTurn).content === 'string' && ((turn as CodaHistoryTurn).role === 'user' || (turn as CodaHistoryTurn).role === 'assistant'))
        .slice(-8)
      : [];
    return {
      mode: parsed.mode === 'sort' || parsed.mode === 'inspect' || parsed.mode === 'guide' ? parsed.mode : 'guide',
      text: typeof parsed.text === 'string' ? parsed.text : '',
      history,
      result: parsed.result && typeof parsed.result === 'object' ? parsed.result : null,
      createdWorldTarget: parsed.createdWorldTarget && typeof parsed.createdWorldTarget.id === 'string'
        ? { id: parsed.createdWorldTarget.id, name: String(parsed.createdWorldTarget.name ?? '') }
        : null,
      createdProposalIds: parsed.createdProposalIds && typeof parsed.createdProposalIds === 'object' && !Array.isArray(parsed.createdProposalIds)
        ? Object.fromEntries(Object.entries(parsed.createdProposalIds).filter(([, value]) => typeof value === 'string'))
        : {},
    };
  } catch {
    return emptyThread;
  }
}

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
    writeReport: result.writeReport ?? '',
    proposals: result.proposals ?? [],
    questions: result.questions ?? [],
    warnings: result.warnings ?? [],
    recordPatch: result.recordPatch ?? null,
  }).slice(0, 60_000);
}

/** Turns a proposal into the structured operation the Orbis runtime executes. */
function proposalToOperation(proposal: CodaProposal, rating: ContentRating): CodaOperation {
  return {
    op: 'create',
    type: proposal.type,
    name: proposal.name,
    fields: proposal.fields ?? {},
    contentRating: rating,
  };
}

function WriteResults({ results, report }: { results: CodaWriteResult[]; report?: string }) {
  if (!results.length) return null;
  const applied = results.filter((result) => result.status === 'applied');
  const failed = results.filter((result) => result.status !== 'applied');
  return <section className="coda-write-results">
    <header>
      <strong>{applied.length ? `${applied.length} of ${results.length} confirmed by Orbis` : 'Nothing was saved'}</strong>
      {failed.length > 0 && <span className="coda-write-results__failed">{failed.length} failed</span>}
    </header>
    <ul>{results.map((result) => <li key={`${result.index}-${result.requestedName}`} className={result.status === 'applied' ? 'is-applied' : 'is-failed'}>
      {result.status === 'applied' ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
      <span>
        <strong>{result.status === 'applied' ? `${result.operation === 'create' ? 'Created' : 'Updated'} ${result.recordType}` : 'Not saved'}: {result.requestedName}</strong>
        {result.status === 'applied'
          ? <small>record {result.recordId} · revision {result.revision}{result.changedFields.length ? ` · changed ${result.changedFields.join(', ')}` : ' · no field changes'}</small>
          : <small>{result.message}</small>}
        {result.status === 'applied' && result.recordId && <Link to={`/asset/${result.recordId}`}>Open record</Link>}
      </span>
    </li>)}</ul>
    {report && <p className="coda-write-report">{report}</p>}
  </section>;
}

function StringList({ title, values, tone }: { title: string; values?: string[]; tone?: 'warning' }) {
  if (!values?.length) return null;
  return <section className={`coda-result-list ${tone === 'warning' ? 'is-warning' : ''}`}><strong>{title}</strong><ul>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul></section>;
}

function ProposalCard({ proposal, index, canCreate, result, onCreate }: {
  proposal: CodaProposal;
  index: number;
  canCreate: boolean;
  result?: CodaWriteResult;
  onCreate: (proposal: CodaProposal, rating: ContentRating, index: number) => Promise<void>;
}) {
  const [rating, setRating] = useState<ContentRating>('sfw');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const create = async () => {
    if (creating || result?.status === 'applied') return;
    setCreating(true);
    setCreateError('');
    try {
      await onCreate(proposal, rating, index);
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : 'Orbis could not run that operation.');
    } finally {
      setCreating(false);
    }
  };

  return <article className="coda-proposal" key={`${proposal.type}-${proposal.name}-${index}`}>
    <header><span>{proposal.type}</span><b>{proposal.name}</b><small className={`confidence confidence--${proposal.confidence}`}>{proposal.confidence}</small></header>
    {proposal.reason && <p>{proposal.reason}</p>}
    {proposal.fields && Object.keys(proposal.fields).length > 0 && <details className="coda-field-preview"><summary>Proposed fields</summary><pre>{JSON.stringify(proposal.fields, null, 2)}</pre></details>}
    {result?.status === 'applied' && <p className="coda-proposal__saved">
      <CheckCircle2 size={14} /> Saved by Orbis as record {result.recordId} (revision {result.revision}).
    </p>}
    {canCreate && result?.status !== 'applied' && <div className="coda-proposal__create">
      <label><span>Rating</span><select value={rating} onChange={(event) => setRating(event.target.value as ContentRating)} disabled={creating}><option value="sfw">SFW</option><option value="adult">Adult</option></select></label>
      <button type="button" className="button button--primary" disabled={creating} onClick={() => void create()}>{creating ? 'Running...' : `Ask Orbis to create ${proposal.type}`}</button>
    </div>}
    {createError && <p className="coda-create-error" role="alert">{createError}</p>}
  </article>;
}

function SortResult({ result, canApply, canCreate, canRun, writeResults, bulkRunning, onApply, onCreate, onCreateAll }: {
  result: CodaAssistantResponse;
  canApply: boolean;
  canCreate: boolean;
  canRun: boolean;
  writeResults: CodaWriteResult[];
  bulkRunning: boolean;
  onApply: () => void;
  onCreate: (proposal: CodaProposal, rating: ContentRating, index: number) => Promise<void>;
  onCreateAll: (rating: ContentRating) => Promise<void>;
}) {
  const [bulkRating, setBulkRating] = useState<ContentRating>('sfw');
  const proposals = result.proposals ?? [];
  const operationFor = (proposal: CodaProposal, index: number) => writeResults.find((entry) => entry.requestedName === proposal.name && entry.operation === 'create');
  const savedCount = writeResults.filter((entry) => entry.status === 'applied').length;
  const hasResults = writeResults.length > 0;

  return <div className="coda-result">
    {result.summary && <p className="coda-result__summary">{result.summary}</p>}
    <WriteResults results={writeResults} report={result.writeReport} />
    {result.pendingOperations ? <p className="coda-pending-note">
      Coda drafted {result.pendingOperations} operation{result.pendingOperations === 1 ? '' : 's'}. Nothing has been saved yet.
    </p> : null}
    {proposals.length ? <section className="coda-proposals">
      <div className="coda-proposals__heading"><strong>Proposed records</strong>{canCreate && canRun && <div className="coda-finalize"><select aria-label="Create all content rating" value={bulkRating} onChange={(event) => setBulkRating(event.target.value as ContentRating)} disabled={bulkRunning}><option value="sfw">All SFW</option><option value="adult">All Adult</option></select><button type="button" className="button button--primary" disabled={bulkRunning} onClick={() => void onCreateAll(bulkRating)}>{bulkRunning ? 'Running...' : 'Ask Orbis to create all'}</button></div>}</div>
      {proposals.map((proposal, index) => <ProposalCard proposal={proposal} index={index} canCreate={canCreate} result={operationFor(proposal, index)} onCreate={onCreate} key={`${proposal.type}-${proposal.name}-${index}`} />)}
    </section> : null}
    <StringList title="Needs your answer" values={result.questions} />
    <StringList title="Coda noticed" values={result.warnings} tone="warning" />
    {result.text && <pre className="coda-raw-draft">{result.text}</pre>}
    {result.recordPatch && <section className="coda-draft-ready">
      <div><strong>Unsaved editor draft</strong><small>This is a draft, not a save. It fills the editor without overwriting authored values; use the editor's Save button to write it.</small></div>
      <details className="coda-field-preview"><summary>Preview draft patch</summary><pre>{JSON.stringify(result.recordPatch, null, 2)}</pre></details>
      {canApply && <button type="button" className="button button--primary" onClick={onApply}>Load draft into editor</button>}
    </section>}
    {hasResults && savedCount === 0 && <p className="coda-create-error" role="alert">Coda did not complete any of these changes. Nothing was saved.</p>}
  </div>;
}

export function CodaAssistant() {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [restored] = useState(readStoredThread);
  const [mode, setMode] = useState<CodaMode>(restored.mode);
  const [text, setText] = useState(restored.text);
  const [includeContext, setIncludeContext] = useState(false);
  const [result, setResult] = useState<CodaAssistantResponse | null>(restored.result);
  const [error, setError] = useState('');
  const [settingsPath, setSettingsPath] = useState('');
  const [working, setWorking] = useState(false);
  const [applied, setApplied] = useState(false);
  const [createdWorldTarget, setCreatedWorldTarget] = useState<{ id: string; name: string } | null>(restored.createdWorldTarget);
  const [history, setHistory] = useState<CodaHistoryTurn[]>(restored.history);
  const [createdProposalIds, setCreatedProposalIds] = useState<Record<string, string>>(restored.createdProposalIds);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [writeResults, setWriteResults] = useState<CodaWriteResult[]>([]);
  const [writeReport, setWriteReport] = useState('');
  const transcriptRef = useRef<HTMLDivElement>(null);

  const assetId = useMemo(() => currentAssetId(location.pathname), [location.pathname]);
  const inEditor = Boolean(assetId && location.pathname === `/asset/${assetId}/edit`);
  const active = modes.find((item) => item.id === mode)!;

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [result, error, writeResults, writeReport, createdWorldTarget, applied, working]);

  useEffect(() => {
    try {
      window.localStorage.setItem(THREAD_STORAGE_KEY, JSON.stringify({ mode, text, history, result, createdWorldTarget, createdProposalIds }));
    } catch {
      // Storage can be full or blocked; the thread then lives only in this tab.
    }
  }, [mode, text, history, result, createdWorldTarget, createdProposalIds]);

  useEffect(() => () => { document.body.classList.remove(OVERLAY_ACTIVE_CLASS); }, []);

  useEffect(() => {
    setIncludeContext(false);
    setError('');
    setSettingsPath('');
    setApplied(false);
  }, [assetId]);

  const clearThread = () => {
    setHistory([]);
    setResult(null);
    setText('');
    setCreatedWorldTarget(null);
    setCreatedProposalIds({});
    setWriteResults([]);
    setWriteReport('');
    setError('');
    try {
      window.localStorage.removeItem(THREAD_STORAGE_KEY);
    } catch {
      // Ignore storage failures; state is already cleared.
    }
  };

  const run = async () => {
    const input = text.trim();
    if (!input || working) return;
    setWorking(true);
    setError('');
    setSettingsPath('');
    setApplied(false);
    setCreatedProposalIds({});
    setCreatedWorldTarget(null);
    setWriteResults([]);
    setWriteReport('');
    try {
      const next = await askCoda({
        mode, text: input, history, pageHint: pageHint(location.pathname),
        // Sort mode may execute Coda's operations; the runtime reports the real outcome.
        ...(mode === 'sort' ? { applyOperations: true } : {}),
        ...(assetId ? { assetId, includeRecordContext: includeContext } : {}),
      });
      setResult(next);
      setWriteResults(next.writeResults ?? []);
      setWriteReport(next.writeReport ?? '');
      setHistory((current): CodaHistoryTurn[] => [...current, { role: 'user' as const, content: input }, { role: 'assistant' as const, content: assistantHistoryText(next) }].slice(-8));
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

  const runOperations = async (operations: CodaOperation[], originWorldId: string | null) => {
    if (!operations.length) return { writeResults: [] as CodaWriteResult[], writeReport: '' };
    const outcome = await runCodaOperations({ operations, originWorldId });
    setWriteResults((current) => [...outcome.writeResults.map((entry) => ({ ...entry, index: current.length + entry.index })), ...current]);
    setWriteReport(outcome.writeReport);
    return outcome;
  };

  const createProposal = async (proposal: CodaProposal, rating: ContentRating, index: number) => {
    if (!user?.permissions.canCreate) throw new Error('Creator access is required before Orbis can write records.');
    const originWorldId = proposal.type === 'world'
      ? null
      : result?.record?.canAddToWorld === true ? result.record.originWorldId ?? null : createdWorldTarget?.id ?? null;
    const outcome = await runOperations([proposalToOperation(proposal, rating)], originWorldId);
    const created = outcome.writeResults.find((entry) => entry.status === 'applied' && entry.recordId);
    if (created?.recordId) {
      setCreatedProposalIds((current) => ({ ...current, [proposalKey(proposal, index)]: created.recordId! }));
      if (proposal.type === 'world' && created.recordId) setCreatedWorldTarget({ id: created.recordId, name: proposal.name });
    } else {
      setError(outcome.writeReport || 'Orbis did not save that record.');
    }
  };

  const createAllProposals = async (rating: ContentRating) => {
    if (!user?.permissions.canCreate || !result?.proposals?.length || bulkCreating) return;
    setBulkCreating(true);
    setError('');
    setWriteReport('');

    const proposals = result.proposals;
    const contextWorldId = result.record?.canAddToWorld === true ? result.record.originWorldId ?? null : null;
    // Worlds first so dependent records can attach to a world Orbis actually created.
    const worldEntries = proposals.map((proposal, index) => ({ proposal, index })).filter((entry) => entry.proposal.type === 'world');
    const otherEntries = proposals.map((proposal, index) => ({ proposal, index })).filter((entry) => entry.proposal.type !== 'world');
    const worldByName = new Map<string, string>();
    let soleCreatedWorldId: string | null = null;

    for (const entry of worldEntries) {
      const existing = createdProposalIds[proposalKey(entry.proposal, entry.index)];
      if (existing) {
        worldByName.set(entry.proposal.name.toLocaleLowerCase(), existing);
        soleCreatedWorldId = existing;
        continue;
      }
      const outcome = await runOperations([proposalToOperation(entry.proposal, rating)], null);
      const created = outcome.writeResults.find((item) => item.status === 'applied' && item.recordId);
      if (created?.recordId) {
        worldByName.set(entry.proposal.name.toLocaleLowerCase(), created.recordId);
        soleCreatedWorldId = created.recordId;
        setCreatedProposalIds((current) => ({ ...current, [proposalKey(entry.proposal, entry.index)]: created.recordId! }));
        setCreatedWorldTarget({ id: created.recordId, name: entry.proposal.name });
      }
    }

    for (const entry of otherEntries) {
      if (createdProposalIds[proposalKey(entry.proposal, entry.index)]) continue;
      const fields = entry.proposal.fields ?? {};
      const requestedWorldName = ['parentWorldName', 'worldName', 'originWorldName']
        .map((field) => typeof fields[field] === 'string' ? String(fields[field]).trim().toLocaleLowerCase() : '')
        .find(Boolean);
      const originWorldId = contextWorldId
        ?? (requestedWorldName ? worldByName.get(requestedWorldName) ?? null : null)
        ?? (worldByName.size === 1 ? soleCreatedWorldId : null);
      await runOperations([proposalToOperation(entry.proposal, rating)], originWorldId);
    }
    setBulkCreating(false);
  };

  const canCreateProposal = () => Boolean(user?.permissions.canCreate);

  return <>
    {open && <aside
      className="coda-assistant"
      aria-label="Coda Assistant"
      onMouseEnter={() => document.body.classList.add(OVERLAY_ACTIVE_CLASS)}
      onMouseLeave={() => document.body.classList.remove(OVERLAY_ACTIVE_CLASS)}
    >
      <header className="coda-assistant__header">
        <div className="coda-assistant__mark"><Sparkles size={19} /></div>
        <div><span>OVERLAY ACTIVE</span><strong>Coda Assistant</strong></div>
        <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close Coda Assistant"><X size={17} /></button>
      </header>

      <nav className="coda-mode-tabs" aria-label="Coda modes">
        {modes.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={mode === id ? 'is-active' : ''} onClick={() => { setMode(id); setResult(null); setError(''); setApplied(false); setWriteResults([]); setWriteReport(''); }}>
          <Icon size={15} /><span>{label}</span>
        </button>)}
      </nav>

      <div className="coda-assistant__body">
        <p className="coda-mode-hint">{active.hint}</p>
        <div className="coda-transcript" ref={transcriptRef} role="log" aria-live="polite" aria-label="Coda replies">
          {result?.record && result.record.id !== assetId && <div className="coda-notice"><strong>Still showing {result.record.name}'s reply.</strong><span>Its proposals stay bound to that record's world. Reopen that record to apply its draft, or clear the thread to start over.</span></div>}
          {error && <div className="coda-notice is-error"><strong>{error}</strong>{settingsPath && <Link to={settingsPath}>Open Account settings</Link>}</div>}
          {result && (mode === 'sort'
            ? <SortResult
                result={result}
                canApply={Boolean(inEditor && result.record?.id === assetId)}
                canCreate={Boolean(user?.permissions.canCreate)}
                canRun
                bulkRunning={bulkCreating}
                writeResults={writeResults}
                onApply={applyDraft}
                onCreate={createProposal}
                onCreateAll={createAllProposals}
              />
            : <div className="coda-result coda-result--text"><p>{result.text}</p>{result.writeReport && <p className="coda-write-report">{result.writeReport}</p>}</div>)}
          {createdWorldTarget && mode === 'sort' && writeResults.some((entry) => entry.status === 'applied' && entry.recordType === 'world') && <div className="coda-notice is-success"><strong>{createdWorldTarget.name} created privately.</strong><span>Orbis confirmed the write. Related records can be created inside that world; standalone records remain supported too.</span></div>}
          {applied && <div className="coda-notice"><strong>Draft loaded into the editor, not saved.</strong><span>Nothing was written yet. Review the fields and use the editor's Save button to store the change.</span></div>}
        </div>

        <div className="coda-composer">
          {!user ? <div className="coda-notice"><strong>Coda needs an Orbis account.</strong><span>Sign in with Discord first, then she can use your configured AI provider.</span></div> : <>
            {history.length > 0 && <div className="coda-thread-status"><span>Coda remembers this thread · {Math.floor(history.length / 2)} exchange{history.length === 2 ? '' : 's'}</span><button type="button" onClick={clearThread}>Clear thread</button></div>}
            <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={history.length ? (result?.questions?.length ? 'Answer Coda here. She will remember the earlier question and your original material.' : 'Give Coda the next instruction in this thread...') : active.placeholder} rows={mode === 'sort' ? 9 : 6} />
            {assetId && <label className="coda-context-toggle">
              <input type="checkbox" checked={includeContext} onChange={(event) => setIncludeContext(event.target.checked)} />
              <span><strong>Include current record</strong><small>Off by default. Only this record is sent to your configured provider.</small></span>
            </label>}
            <button type="button" className="button button--primary coda-submit" disabled={working || !text.trim()} onClick={() => void run()}>
              <Send size={15} /> {working ? 'Coda is sniffing...' : mode === 'sort' ? 'Sort with Coda' : mode === 'inspect' ? 'Inspect with Coda' : 'Ask Coda'}
            </button>
          </>}
        </div>
      </div>

      <footer className="coda-assistant__footer">
        <span>Coda interprets and drafts; the Orbis runtime performs and confirms every write. Nothing is saved until Orbis reports a record ID and revision.</span>
        {result?.model && <small>{result.model}{result.requestId ? ' · log ' + result.requestId.slice(0, 8) : ''}</small>}
      </footer>
    </aside>}

    <button type="button" className={`coda-launcher ${open ? 'is-open' : ''}`} onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close Coda Assistant' : 'Open Coda Assistant'}>
      <Sparkles size={20} />
      <span><strong>CODA</strong><small>{open ? 'overlay active' : 'assistant'}</small></span>
    </button>
  </>;
}
