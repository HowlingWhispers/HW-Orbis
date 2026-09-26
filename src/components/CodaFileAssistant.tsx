import { BookOpen, RotateCcw, Send, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { askCoda, CodaAssistantError, type CodaAssistantResponse, type CodaHistoryTurn } from '../api/coda-assistant';
import type { LibraryAsset } from '../types/library';

type WorldTarget = {
  value: string;
  label: string;
  sectionLabel: string;
  keys: string[];
  singleCollectionKey?: string;
  singular?: string;
};

const worldTargets: WorldTarget[] = [
  { value: 'identity', label: 'Identity', sectionLabel: 'Identity', keys: ['identity'] },
  { value: 'lore', label: 'Lore', sectionLabel: 'Lore', keys: ['lore'] },
  { value: 'place', label: 'Add one place', sectionLabel: 'Places', keys: ['locations'], singleCollectionKey: 'locations', singular: 'place' },
  { value: 'species', label: 'Add one species', sectionLabel: 'Species & Factions', keys: ['species'], singleCollectionKey: 'species', singular: 'species' },
  { value: 'faction', label: 'Add one faction', sectionLabel: 'Species & Factions', keys: ['factions'], singleCollectionKey: 'factions', singular: 'faction' },
  { value: 'society', label: 'Add one society', sectionLabel: 'Peoples & Societies', keys: ['societies'], singleCollectionKey: 'societies', singular: 'society' },
  { value: 'family', label: 'Add one family', sectionLabel: 'Family Trees', keys: ['families'], singleCollectionKey: 'families', singular: 'family' },
  { value: 'memory', label: 'Add one memory/event', sectionLabel: 'Memory & Timeline', keys: ['memories'], singleCollectionKey: 'memories', singular: 'memory or event' },
  { value: 'rules', label: 'Rules', sectionLabel: 'Rules', keys: ['rules'] },
  { value: 'time', label: 'Time & Weather', sectionLabel: 'Time & Weather', keys: ['timeWeather'] },
  { value: 'brain', label: 'World Brain', sectionLabel: 'World Brain', keys: ['brain', 'worldBrain'] },
];

function historyText(result: CodaAssistantResponse) {
  return JSON.stringify({
    summary: result.summary ?? '',
    questions: result.questions ?? [],
    warnings: result.warnings ?? [],
    recordPatch: result.recordPatch ?? null,
  }).slice(0, 12_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactCollectionIndex(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((item) => {
    if (!isRecord(item)) return item;
    const compact: Record<string, unknown> = {};
    for (const key of ['id', 'name', 'title', 'kind', 'type', 'classification', 'parentSpeciesName', 'parentLocationId', 'parentSocietyId']) {
      const child = item[key];
      if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') compact[key] = child;
    }
    return Object.keys(compact).length ? compact : { name: '(unnamed entry)' };
  });
}

function compactWorldTargetContext(asset: LibraryAsset, target: WorldTarget) {
  const document = asset.document ?? {};
  const context: Record<string, unknown> = {
    world: asset.name,
    identity: isRecord(document.identity) ? document.identity : {},
  };

  for (const key of target.keys) {
    if (target.singleCollectionKey === key) {
      const collection = document[key];
      context[key] = {
        existingCount: Array.isArray(collection) ? collection.length : 0,
        existingIndex: compactCollectionIndex(collection),
      };
    } else if (Object.prototype.hasOwnProperty.call(document, key)) {
      context[key] = document[key];
    }
  }

  const serialized = JSON.stringify(context);
  return serialized.length > 12_000
    ? `${serialized.slice(0, 12_000)}\n[compact target context truncated]`
    : serialized;
}

function scopeWorldPatch(patch: unknown, target: WorldTarget) {
  if (!isRecord(patch)) return null;

  if (target.singleCollectionKey) {
    const incoming = patch[target.singleCollectionKey];
    if (!Array.isArray(incoming) || incoming.length === 0) return null;
    return { [target.singleCollectionKey]: [incoming[0]] };
  }

  const scoped = Object.fromEntries(
    target.keys
      .filter((key) => Object.prototype.hasOwnProperty.call(patch, key))
      .map((key) => [key, patch[key]]),
  );
  return Object.keys(scoped).length > 0 ? scoped : null;
}

function focusWorldForgeSection(label: string) {
  if (!label) return;
  window.requestAnimationFrame(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.forge-tabs button')];
    buttons.find((button) => button.textContent?.trim() === label)?.click();
  });
}

export function CodaFileAssistant({ asset }: { asset: LibraryAsset }) {
  const [text, setText] = useState('');
  const [history, setHistory] = useState<CodaHistoryTurn[]>([]);
  const [result, setResult] = useState<CodaAssistantResponse | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [settingsPath, setSettingsPath] = useState('');
  const [applied, setApplied] = useState(false);
  const [appliedSection, setAppliedSection] = useState('');
  const [worldTarget, setWorldTarget] = useState('identity');

  const selectedWorldTarget = asset.type === 'world'
    ? worldTargets.find((target) => target.value === worldTarget) ?? worldTargets[0]
    : undefined;

  const outsideScope = useMemo(
    () => (result?.proposals?.length ?? 0) + (result?.operations?.length ?? 0) > 0,
    [result],
  );

  const run = async () => {
    const input = text.trim();
    if (!input || working) return;
    const target = selectedWorldTarget;
    const targetInstruction = target
      ? target.singleCollectionKey
        ? `\n- TARGET: ${target.label}. Draft exactly ONE new ${target.singular}.\n- recordPatch must contain ONLY the top-level key ${target.singleCollectionKey}, with exactly one new object inside its array.\n- Never echo, rewrite, or return the whole existing ${target.singleCollectionKey} collection. Existing entries are supplied only as a compact index so you can avoid duplicates.\n- If the user describes several entries, draft only the first/next one now. They can ask for the next entry in another turn.`
        : `\n- TARGET WORLD FORGE SECTION: ${target.label}. Put recordPatch changes ONLY under these existing top-level key(s): ${target.keys.join(', ')}. Do not include any other World Forge section.`
      : '';
    const compactContext = target ? compactWorldTargetContext(asset, target) : '';

    setWorking(true);
    setError('');
    setSettingsPath('');
    setApplied(false);
    setAppliedSection('');
    try {
      const next = await askCoda({
        mode: 'sort',
        text: `${input}\n\nFILE-FOCUSED DRAFT MODE:\n- Work only on the currently open ${asset.type} file named ${asset.name}.\n- Put changes for this file in recordPatch.\n- Do not create, update, save, or propose another record.\n- Do not change ownership, privacy, permissions, credentials, content rating, IDs, or other protected metadata.\n- This is an unsaved draft. The human will review it and press Save in Orbis.${targetInstruction}${compactContext ? `\n\nCOMPACT TARGET CONTEXT (reference only; do not copy it wholesale into the patch):\n${compactContext}` : ''}`,
        assetId: asset.id,
        includeRecordContext: asset.type !== 'world',
        pageHint: `File editor · type=${asset.type} · name=${asset.name} · target=${target?.label ?? 'current file'} · current_file_only`.slice(0, 120),
        history,
      });
      setResult(next);
      setHistory((current) => [
        ...current,
        { role: 'user' as const, content: input },
        { role: 'assistant' as const, content: historyText(next) },
      ].slice(-6));
      setText('');
    } catch (reason) {
      if (reason instanceof CodaAssistantError) {
        setError(reason.message);
        setSettingsPath(reason.settingsPath ?? '');
      } else {
        setError(reason instanceof Error ? reason.message : 'Coda could not prepare that draft.');
      }
    } finally {
      setWorking(false);
    }
  };

  const applyDraft = () => {
    if (!result?.recordPatch || result.record?.id !== asset.id) return;
    const target = selectedWorldTarget;
    const patch = target ? scopeWorldPatch(result.recordPatch, target) : result.recordPatch;

    if (!patch) {
      setError(`Coda did not return a valid ${target?.label ?? 'current-file'} patch. Nothing was loaded.`);
      setApplied(false);
      setAppliedSection('');
      return;
    }

    window.dispatchEvent(new CustomEvent('orbis:coda-apply-draft', {
      detail: { assetId: asset.id, patch, preferredSection: target?.sectionLabel ?? '' },
    }));
    if (target) focusWorldForgeSection(target.sectionLabel);
    setError('');
    setAppliedSection(target?.sectionLabel ?? '');
    setApplied(true);
  };

  const clear = () => {
    setHistory([]);
    setResult(null);
    setText('');
    setError('');
    setSettingsPath('');
    setApplied(false);
    setAppliedSection('');
  };

  return <aside className="coda-file-assistant" aria-label="Coda file assistant">
    <header className="coda-file-assistant__header">
      <div className="coda-file-assistant__mark"><Sparkles size={18} /></div>
      <div><span className="eyebrow">Current file only</span><h2>Coda</h2></div>
    </header>

    <section className="coda-file-scope">
      <strong>Coda is editing: {asset.name}</strong>
      <dl>
        <div><dt>Type</dt><dd>{asset.type}</dd></div>
        <div><dt>Record ID</dt><dd>{asset.id}</dd></div>
        <div><dt>World</dt><dd>{asset.type === 'world' ? asset.name : asset.originWorldName ?? asset.originWorldId ?? 'Standalone'}</dd></div>
        <div><dt>Scope</dt><dd>{asset.type === 'world' ? selectedWorldTarget?.label ?? 'World section' : 'current_file_only'}</dd></div>
      </dl>
      {asset.type === 'world' && <label className="forge-field coda-file-target">
        <span>Coda target</span>
        <select value={worldTarget} disabled={working} onChange={(event) => {
          setWorldTarget(event.target.value);
          setResult(null);
          setApplied(false);
          setAppliedSection('');
          setError('');
        }}>
          {worldTargets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
        </select>
        <small>Collections are handled one entry at a time so Coda does not spend tokens rewriting an entire list.</small>
      </label>}
      <p>{asset.type === 'world'
        ? 'Coda receives the selected section plus a compact index of existing entries, not the entire world document. Nothing is saved until you press Save in Orbis.'
        : 'The open file is sent to your configured NovelAI provider so Coda can draft against its real structure. Coda cannot save this panel\'s draft.'}</p>
    </section>

    <div className="coda-file-transcript" aria-live="polite">
      {error && <div className="coda-file-notice is-error"><div><strong>{error}</strong>{settingsPath && <Link to={settingsPath}>Open Account settings</Link>}</div></div>}
      {result?.summary && <p className="coda-file-summary">{result.summary}</p>}
      {result?.questions?.length ? <section><strong>Needs your answer</strong><ul>{result.questions.map((question) => <li key={question}>{question}</li>)}</ul></section> : null}
      {result?.warnings?.length ? <section><strong>Coda noticed</strong><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}
      {outsideScope && <div className="coda-file-notice"><div><strong>Out-of-scope suggestions ignored.</strong><span>This workspace never runs Coda's create/update operations. Only the patch for the open file can be loaded.</span></div></div>}
      {result?.recordPatch ? <section className="coda-file-draft">
        <div><strong>Unsaved draft ready</strong><small>Review the patch, load it into the editor, then use Orbis Save when you are satisfied.</small></div>
        <details><summary>Preview JSON patch</summary><pre>{JSON.stringify(result.recordPatch, null, 2)}</pre></details>
        <button type="button" className="button button--primary" onClick={applyDraft}>Load draft into {selectedWorldTarget?.label ?? 'open file'}</button>
      </section> : result ? <div className="coda-file-notice"><BookOpen size={15} /><span>Coda did not return an editable patch for this file. Give her another instruction and keep it focused on the open record.</span></div> : null}
      {applied && <div className="coda-file-notice is-success"><div><strong>Draft loaded locally{appliedSection ? ` into ${appliedSection}` : ''}.</strong><span>Nothing has been saved yet. Review the editor and press Save yourself.</span></div></div>}
    </div>

    <div className="coda-file-composer">
      {history.length > 0 && <div className="coda-file-thread"><span>{Math.floor(history.length / 2)} exchange{history.length === 2 ? '' : 's'}</span><button type="button" onClick={clear}><RotateCcw size={13} /> Clear</button></div>}
      <textarea
        rows={8}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={`Tell Coda what to add or edit in ${asset.name}...`}
      />
      <button type="button" className="button button--primary" disabled={working || !text.trim()} onClick={() => void run()}>
        <Send size={15} /> {working ? 'Coda is drafting...' : 'Draft with Coda'}
      </button>
    </div>
  </aside>;
}
