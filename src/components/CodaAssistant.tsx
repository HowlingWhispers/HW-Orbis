import { BookOpen, Search, Send, Sparkles, WandSparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { askCoda, CodaAssistantError, type CodaAssistantResponse, type CodaMode } from '../api/coda-assistant';
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

function StringList({ title, values, tone }: { title: string; values?: string[]; tone?: 'warning' }) {
  if (!values?.length) return null;
  return <section className={`coda-result-list ${tone === 'warning' ? 'is-warning' : ''}`}><strong>{title}</strong><ul>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul></section>;
}

function SortResult({ result, canApply, onApply }: { result: CodaAssistantResponse; canApply: boolean; onApply: () => void }) {
  return <div className="coda-result">
    {result.summary && <p className="coda-result__summary">{result.summary}</p>}
    {result.proposals?.length ? <section className="coda-proposals">
      <strong>Proposed records</strong>
      {result.proposals.map((proposal, index) => <article className="coda-proposal" key={`${proposal.type}-${proposal.name}-${index}`}>
        <header><span>{proposal.type}</span><b>{proposal.name}</b><small className={`confidence confidence--${proposal.confidence}`}>{proposal.confidence}</small></header>
        {proposal.reason && <p>{proposal.reason}</p>}
      </article>)}
    </section> : null}
    <StringList title="Needs your answer" values={result.questions} />
    <StringList title="Coda noticed" values={result.warnings} tone="warning" />
    {result.text && <pre className="coda-raw-draft">{result.text}</pre>}
    {result.recordPatch && <section className="coda-draft-ready">
      <div><strong>Current-record draft ready</strong><small>Nothing has been saved. Existing authored values are protected when the draft is applied.</small></div>
      {canApply && <button type="button" className="button button--primary" onClick={onApply}>Apply draft locally</button>}
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

  const assetId = useMemo(() => currentAssetId(location.pathname), [location.pathname]);
  const inEditor = Boolean(assetId && location.pathname === `/asset/${assetId}/edit`);
  const active = modes.find((item) => item.id === mode)!;

  const run = async () => {
    if (!text.trim() || working) return;
    setWorking(true);
    setError('');
    setSettingsPath('');
    setApplied(false);
    try {
      const next = await askCoda({ mode, text: text.trim(), pageHint: pageHint(location.pathname), ...(includeContext && assetId ? { assetId } : {}) });
      setResult(next);
    } catch (reason) {
      setResult(null);
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
    if (!assetId || !result?.recordPatch) return;
    window.dispatchEvent(new CustomEvent('orbis:coda-apply-draft', {
      detail: { assetId, patch: result.recordPatch },
    }));
    setApplied(true);
  };

  return <>
    {open && <aside className="coda-assistant" aria-label="Coda Assistant">
      <header className="coda-assistant__header">
        <div className="coda-assistant__mark"><Sparkles size={19} /></div>
        <div><span>OVERLAY ACTIVE</span><strong>Coda Assistant</strong></div>
        <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close Coda Assistant"><X size={17} /></button>
      </header>

      <nav className="coda-mode-tabs" aria-label="Coda modes">
        {modes.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={mode === id ? 'is-active' : ''} onClick={() => { setMode(id); setResult(null); setError(''); setApplied(false); }}>
          <Icon size={15} /><span>{label}</span>
        </button>)}
      </nav>

      <div className="coda-assistant__body">
        <p className="coda-mode-hint">{active.hint}</p>
        {!user ? <div className="coda-notice"><strong>Coda needs an Orbis account.</strong><span>Sign in with Discord first, then she can use your configured AI provider.</span></div> : <>
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={active.placeholder} rows={mode === 'sort' ? 9 : 6} />
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
          ? <SortResult result={result} canApply={Boolean(inEditor && result.record?.type === 'world')} onApply={applyDraft} />
          : <div className="coda-result coda-result--text"><p>{result.text}</p></div>)}
        {applied && <div className="coda-notice is-success"><strong>Draft placed in the editor.</strong><span>Review the filled fields and use the normal Save button when you are satisfied.</span></div>}
      </div>

      <footer className="coda-assistant__footer">
        <span>Coda proposes. You decide. Requests go only to your configured provider and are not saved by Coda.</span>
        {result?.model && <small>{result.model}</small>}
      </footer>
    </aside>}

    <button type="button" className={`coda-launcher ${open ? 'is-open' : ''}`} onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close Coda Assistant' : 'Open Coda Assistant'}>
      <Sparkles size={20} />
      <span><strong>CODA</strong><small>{open ? 'overlay active' : 'assistant'}</small></span>
    </button>
  </>;
}
