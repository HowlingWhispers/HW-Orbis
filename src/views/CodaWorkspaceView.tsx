import { BookOpen, Check, Database, ExternalLink, Search, Send, Sparkles, WandSparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { askCoda, CodaAssistantError, type CodaAssistantResponse, type CodaHistoryTurn, type CodaMode, type CodaProposal } from '../api/coda-assistant';
import { libraryApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useSEO } from '../hooks/useSEO';
import type { ContentRating, LibraryAsset } from '../types/library';

const STORAGE_KEY = 'coda.workspace.v1';

const modes: Array<{ id: CodaMode; label: string; hint: string; icon: typeof BookOpen }> = [
  { id: 'guide', label: 'Ask', hint: 'Talk through canon, Orbis structure, or what to do next.', icon: BookOpen },
  { id: 'sort', label: 'Organize', hint: 'Sort pasted lore into reviewable Orbis records.', icon: WandSparkles },
  { id: 'inspect', label: 'Inspect', hint: 'Look for repetition, contradictions, gaps, or misplaced lore.', icon: Search },
];

type WorkspaceState = {
  selectedWorldId: string;
  mode: CodaMode;
  includeWorldCanon: boolean;
  includeWorldIndex: boolean;
  preferExisting: boolean;
  extractOnly: boolean;
  history: CodaHistoryTurn[];
};

const defaultState: WorkspaceState = {
  selectedWorldId: '',
  mode: 'sort',
  includeWorldCanon: true,
  includeWorldIndex: true,
  preferExisting: true,
  extractOnly: true,
  history: [],
};

function readWorkspaceState(): WorkspaceState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<WorkspaceState>;
    return {
      selectedWorldId: typeof parsed.selectedWorldId === 'string' ? parsed.selectedWorldId : '',
      mode: parsed.mode === 'guide' || parsed.mode === 'sort' || parsed.mode === 'inspect' ? parsed.mode : 'sort',
      includeWorldCanon: parsed.includeWorldCanon !== false,
      includeWorldIndex: parsed.includeWorldIndex !== false,
      preferExisting: parsed.preferExisting !== false,
      extractOnly: parsed.extractOnly !== false,
      history: Array.isArray(parsed.history)
        ? parsed.history.filter((turn): turn is CodaHistoryTurn => Boolean(turn) && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string').slice(-8)
        : [],
    };
  } catch {
    return defaultState;
  }
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

function exactName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function proposalSummary(proposal: CodaProposal) {
  const fields = proposal.fields ?? {};
  if (typeof fields.summary === 'string') return fields.summary.slice(0, 2000);
  if (typeof fields.description === 'string') return fields.description.slice(0, 2000);
  return (proposal.reason ?? '').slice(0, 2000);
}

export function CodaWorkspaceView() {
  const { user } = useAuth();
  const [restored] = useState(readWorkspaceState);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedWorldId, setSelectedWorldId] = useState(restored.selectedWorldId);
  const [mode, setMode] = useState<CodaMode>(restored.mode);
  const [includeWorldCanon, setIncludeWorldCanon] = useState(restored.includeWorldCanon);
  const [includeWorldIndex, setIncludeWorldIndex] = useState(restored.includeWorldIndex);
  const [preferExisting, setPreferExisting] = useState(restored.preferExisting);
  const [extractOnly, setExtractOnly] = useState(restored.extractOnly);
  const [history, setHistory] = useState<CodaHistoryTurn[]>(restored.history);
  const [text, setText] = useState('');
  const [result, setResult] = useState<CodaAssistantResponse | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [settingsPath, setSettingsPath] = useState('');
  const [worldSearch, setWorldSearch] = useState('');
  const [proposalStatus, setProposalStatus] = useState<Record<string, { id: string; reused: boolean }>>({});
  const [creatingKey, setCreatingKey] = useState('');

  useSEO({
    title: 'Coda Workspace | Orbis',
    description: 'Give Coda a world, a task, and enough room to organize or inspect your Orbis canon.',
    canonicalPath: '/coda',
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    libraryApi.listAssets({ sort: 'name' }, controller.signal)
      .then((response) => {
        setAssets(response.items);
        setLoadError('');
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setLoadError(reason instanceof Error ? reason.message : 'Orbis could not load your worlds.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const worlds = useMemo(
    () => assets.filter((asset) => asset.type === 'world' && asset.canEdit === true),
    [assets],
  );
  const filteredWorlds = useMemo(() => {
    const query = worldSearch.trim().toLocaleLowerCase();
    return query ? worlds.filter((world) => `${world.name} ${world.summary}`.toLocaleLowerCase().includes(query)) : worlds;
  }, [worldSearch, worlds]);
  const selectedWorld = worlds.find((world) => world.id === selectedWorldId);
  const worldRecords = useMemo(
    () => selectedWorldId ? assets.filter((asset) => asset.id === selectedWorldId || asset.originWorldId === selectedWorldId) : [],
    [assets, selectedWorldId],
  );
  const recordCounts = useMemo(() => worldRecords.reduce<Record<string, number>>((counts, asset) => {
    counts[asset.type] = (counts[asset.type] ?? 0) + 1;
    return counts;
  }, {}), [worldRecords]);
  const activeMode = modes.find((item) => item.id === mode)!;

  useEffect(() => {
    if (selectedWorldId && worlds.length > 0 && !worlds.some((world) => world.id === selectedWorldId)) {
      setSelectedWorldId('');
      setHistory([]);
    }
  }, [selectedWorldId, worlds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        selectedWorldId,
        mode,
        includeWorldCanon,
        includeWorldIndex,
        preferExisting,
        extractOnly,
        history,
      } satisfies WorkspaceState));
    } catch {
      // Workspace still works if storage is unavailable.
    }
  }, [selectedWorldId, mode, includeWorldCanon, includeWorldIndex, preferExisting, extractOnly, history]);

  const selectWorld = (id: string) => {
    if (id === selectedWorldId) return;
    setSelectedWorldId(id);
    setHistory([]);
    setResult(null);
    setError('');
    setProposalStatus({});
  };

  const clearThread = () => {
    setHistory([]);
    setResult(null);
    setText('');
    setError('');
    setProposalStatus({});
  };

  const worldIndexBlock = () => {
    if (!includeWorldIndex || !selectedWorld) return '';
    const rows = worldRecords
      .slice(0, 180)
      .map((asset) => `- ${asset.type.toUpperCase()}: ${asset.name}${asset.summary ? ` — ${asset.summary.slice(0, 240)}` : ''}`)
      .join('\n');
    return `\n\nORBIS WORKSPACE INDEX FOR ${selectedWorld.name.toUpperCase()}\nThese records already exist. Treat this as a duplicate-avoidance index, not new user lore.\n${rows || '- No linked records found.'}${worldRecords.length > 180 ? `\n- ... ${worldRecords.length - 180} more record(s) omitted from this compact index.` : ''}`;
  };

  const workingRulesBlock = () => {
    const rules = [
      'WORKSPACE RULES:',
      `- Active world: ${selectedWorld?.name ?? 'none'}.`,
      '- Do not propose creating a second world when an active world is selected. Put world-level additions in recordPatch instead.',
    ];
    if (preferExisting) rules.push('- Prefer an existing record from the workspace index when the supplied lore clearly belongs there. Do not create same-name duplicates.');
    if (extractOnly) rules.push('- Extraction mode is on: organize supplied canon without inventing new canon unless the user explicitly asks you to invent something.');
    return `\n\n${rules.join('\n')}`;
  };

  const run = async () => {
    const input = text.trim();
    if (!input || !selectedWorld || working) return;
    setWorking(true);
    setError('');
    setSettingsPath('');
    setProposalStatus({});
    try {
      const promptText = `${input}${workingRulesBlock()}${worldIndexBlock()}`;
      const next = await askCoda({
        mode,
        text: promptText,
        history,
        pageHint: `Coda workspace for ${selectedWorld.name}`,
        assetId: selectedWorld.id,
        includeRecordContext: includeWorldCanon,
      });
      setResult(next);
      setHistory((current) => [...current, { role: 'user' as const, content: input }, { role: 'assistant' as const, content: assistantHistoryText(next) }].slice(-8));
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

  const createProposal = async (proposal: CodaProposal, index: number, rating: ContentRating) => {
    if (!selectedWorld || proposal.type === 'world' || creatingKey) return;
    const key = `${index}:${proposal.type}:${exactName(proposal.name)}`;
    setCreatingKey(key);
    setError('');
    try {
      const matches = await libraryApi.listAssets({ type: proposal.type, search: proposal.name });
      const existing = matches.items.find((asset) => asset.originWorldId === selectedWorld.id && exactName(asset.name) === exactName(proposal.name));
      if (existing) {
        setProposalStatus((current) => ({ ...current, [key]: { id: existing.id, reused: true } }));
        return;
      }
      const created = await libraryApi.createAsset({
        type: proposal.type,
        name: proposal.name,
        summary: proposalSummary(proposal),
        originWorldId: selectedWorld.id,
        contentRating: rating,
        tags: [],
        visualTone: 'moon',
        document: proposal.fields ?? {},
      });
      setAssets((current) => [...current, created]);
      setProposalStatus((current) => ({ ...current, [key]: { id: created.id, reused: false } }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Orbis could not create that proposal.');
    } finally {
      setCreatingKey('');
    }
  };

  if (!user) {
    return <div className="page coda-workspace-page"><section className="coda-workspace-empty"><Sparkles size={28} /><h1>Coda Workspace</h1><p>Sign in with Discord first. Coda needs an Orbis account and your configured NovelAI provider before she can work on private worlds.</p></section></div>;
  }

  return (
    <div className="page coda-workspace-page">
      <header className="coda-workspace-hero">
        <div className="coda-workspace-hero__mark"><Sparkles size={24} /></div>
        <div><span className="eyebrow">Coda's bigger desk</span><h1>Coda Workspace</h1><p>Pick one of your worlds, decide how much context Coda may use, then give her enough room to actually work.</p></div>
      </header>

      <div className="coda-workspace-layout">
        <aside className="coda-workspace-sidebar">
          <section className="coda-workspace-panel">
            <div className="coda-workspace-panel__heading"><div><span>1</span><strong>Choose a world</strong></div><small>{worlds.length} editable</small></div>
            <label className="coda-world-search"><Search size={15} /><input value={worldSearch} onChange={(event) => setWorldSearch(event.target.value)} placeholder="Find your world..." /></label>
            {loading && <p className="coda-workspace-muted">Sniffing through your shelves...</p>}
            {loadError && <p className="coda-workspace-error">{loadError}</p>}
            {!loading && !loadError && filteredWorlds.length === 0 && <p className="coda-workspace-muted">No editable worlds found here yet.</p>}
            <div className="coda-world-list">
              {filteredWorlds.map((world) => (
                <label className={`coda-world-choice ${selectedWorldId === world.id ? 'is-selected' : ''}`} key={world.id}>
                  <input type="checkbox" checked={selectedWorldId === world.id} onChange={() => selectWorld(world.id)} />
                  <span className="coda-world-choice__check">{selectedWorldId === world.id && <Check size={13} />}</span>
                  <span><strong>{world.name}</strong><small>{world.summary || 'No summary yet.'}</small></span>
                </label>
              ))}
            </div>
          </section>

          <section className="coda-workspace-panel">
            <div className="coda-workspace-panel__heading"><div><span>2</span><strong>Context</strong></div><Database size={15} /></div>
            <label className="coda-workspace-toggle"><input type="checkbox" checked={includeWorldCanon} onChange={(event) => setIncludeWorldCanon(event.target.checked)} /><span><strong>World canon</strong><small>Send the selected world's record document to your provider.</small></span></label>
            <label className="coda-workspace-toggle"><input type="checkbox" checked={includeWorldIndex} onChange={(event) => setIncludeWorldIndex(event.target.checked)} /><span><strong>Record index</strong><small>Give Coda names and summaries of records already attached to this world.</small></span></label>
            <label className="coda-workspace-toggle"><input type="checkbox" checked={preferExisting} onChange={(event) => setPreferExisting(event.target.checked)} /><span><strong>Prefer existing records</strong><small>Tell Coda to reuse obvious matches instead of proposing duplicates.</small></span></label>
            <label className="coda-workspace-toggle"><input type="checkbox" checked={extractOnly} onChange={(event) => setExtractOnly(event.target.checked)} /><span><strong>Extraction mode</strong><small>Do not invent new canon unless you explicitly ask for it.</small></span></label>
          </section>

          {selectedWorld && <section className="coda-workspace-panel coda-workspace-world-summary">
            <div className="coda-workspace-panel__heading"><div><span>3</span><strong>Active shelf</strong></div><Link to={`/asset/${selectedWorld.id}`} title="Open world"><ExternalLink size={15} /></Link></div>
            <h3>{selectedWorld.name}</h3>
            <p>{selectedWorld.summary || 'No summary yet.'}</p>
            <div className="coda-workspace-counts">
              {Object.entries(recordCounts).sort(([a], [b]) => a.localeCompare(b)).map(([type, count]) => <span key={type}><b>{count}</b>{type}</span>)}
            </div>
          </section>}
        </aside>

        <section className="coda-workbench">
          <nav className="coda-workbench-tabs" aria-label="Coda workspace modes">
            {modes.map(({ id, label, icon: Icon }) => <button type="button" className={mode === id ? 'is-active' : ''} onClick={() => { setMode(id); setResult(null); setProposalStatus({}); }} key={id}><Icon size={16} />{label}</button>)}
          </nav>

          <div className="coda-workbench-heading">
            <div><span className="eyebrow">{selectedWorld ? `Working on ${selectedWorld.name}` : 'No active world'}</span><h2>{activeMode.label}</h2><p>{activeMode.hint}</p></div>
            {history.length > 0 && <button type="button" className="button button--secondary" onClick={clearThread}><X size={14} /> Clear thread</button>}
          </div>

          <div className="coda-workbench-output" role="log" aria-live="polite">
            {!selectedWorld && <div className="coda-workspace-callout"><Sparkles size={19} /><div><strong>Give me a shelf first. 🐾</strong><p>Tick one world on the left. Changing worlds starts a clean thread so I don't drag somebody else's canon into the wrong universe.</p></div></div>}
            {selectedWorld && !result && !error && <div className="coda-workspace-callout"><Database size={19} /><div><strong>{worldRecords.length} record{worldRecords.length === 1 ? '' : 's'} in reach.</strong><p>Coda can use the world document and a compact record index without stuffing every linked document into one enormous prompt.</p></div></div>}
            {error && <div className="coda-workspace-callout is-error"><div><strong>{error}</strong>{settingsPath && <p><Link to={settingsPath}>Open Account settings</Link></p>}</div></div>}
            {result?.summary && <p className="coda-workspace-summary">{result.summary}</p>}
            {result?.text && <div className="coda-workspace-text">{result.text}</div>}
            {result?.questions?.length ? <section className="coda-workspace-result-list"><strong>Needs your answer</strong><ul>{result.questions.map((question) => <li key={question}>{question}</li>)}</ul></section> : null}
            {result?.warnings?.length ? <section className="coda-workspace-result-list is-warning"><strong>Coda noticed</strong><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}
            {result?.recordPatch && <section className="coda-workspace-patch"><div><strong>World-level draft</strong><small>Coda kept these changes on the selected world instead of inventing another world.</small></div><details><summary>Preview world patch</summary><pre>{JSON.stringify(result.recordPatch, null, 2)}</pre></details><Link className="button button--secondary" to={`/asset/${selectedWorldId}/edit`}>Open world editor</Link></section>}
            {result?.proposals?.length ? <section className="coda-workspace-proposals"><div className="coda-workspace-proposals__heading"><strong>Proposed records</strong><small>{result.proposals.filter((proposal) => proposal.type !== 'world').length} creatable inside {selectedWorld?.name}</small></div>{result.proposals.map((proposal, index) => <WorkspaceProposal key={`${proposal.type}-${proposal.name}-${index}`} proposal={proposal} index={index} selectedWorldId={selectedWorldId} status={proposalStatus[`${index}:${proposal.type}:${exactName(proposal.name)}`]} creating={creatingKey === `${index}:${proposal.type}:${exactName(proposal.name)}`} onCreate={createProposal} />)}</section> : null}
          </div>

          <div className="coda-workbench-composer">
            {history.length > 0 && <div className="coda-workbench-memory"><span>Coda remembers {Math.floor(history.length / 2)} exchange{history.length === 2 ? '' : 's'} in this world thread.</span><small>Switching worlds clears it automatically.</small></div>}
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={13} maxLength={60_000} placeholder={selectedWorld ? 'Give Coda lore, notes, an import chunk, or a job to do in this world...' : 'Choose a world first...'} disabled={!selectedWorld || working} />
            <div className="coda-workbench-composer__footer"><span>{text.length.toLocaleString()} / 60,000</span><button type="button" className="button button--primary" disabled={!selectedWorld || !text.trim() || working} onClick={() => void run()}><Send size={15} />{working ? 'Coda is sorting the pile...' : `Run ${activeMode.label}`}</button></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function WorkspaceProposal({ proposal, index, selectedWorldId, status, creating, onCreate }: {
  proposal: CodaProposal;
  index: number;
  selectedWorldId: string;
  status?: { id: string; reused: boolean };
  creating: boolean;
  onCreate: (proposal: CodaProposal, index: number, rating: ContentRating) => Promise<void>;
}) {
  const [rating, setRating] = useState<ContentRating>('sfw');
  const worldProposal = proposal.type === 'world';
  return <article className={`coda-workspace-proposal ${worldProposal ? 'is-world' : ''}`}>
    <header><span>{proposal.type}</span><strong>{proposal.name}</strong><small className={`confidence confidence--${proposal.confidence}`}>{proposal.confidence}</small></header>
    {proposal.reason && <p>{proposal.reason}</p>}
    {proposal.fields && Object.keys(proposal.fields).length > 0 && <details><summary>Proposed fields</summary><pre>{JSON.stringify(proposal.fields, null, 2)}</pre></details>}
    {worldProposal ? <div className="coda-workspace-proposal__note">World creation is disabled inside a selected-world workspace. Ask Coda to put world-level changes in the world draft instead.</div> : <div className="coda-workspace-proposal__actions">
      <select value={rating} onChange={(event) => setRating(event.target.value as ContentRating)} disabled={creating || Boolean(status)}><option value="sfw">SFW</option><option value="adult">Adult</option></select>
      {status ? <Link className="button button--secondary" to={`/asset/${status.id}/edit`}>{status.reused ? 'Open existing record' : 'Open created record'}</Link> : <button type="button" className="button button--primary" disabled={creating || !selectedWorldId} onClick={() => void onCreate(proposal, index, rating)}>{creating ? 'Checking shelves...' : `Create ${proposal.type}`}</button>}
    </div>}
  </article>;
}
