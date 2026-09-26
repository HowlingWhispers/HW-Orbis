import { BookOpen, RotateCcw, Send, Sparkles, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { libraryApi } from '../api/client';
import { askCoda, CodaAssistantError, type CodaAssistantResponse, type CodaHistoryTurn } from '../api/coda-assistant';
import type { LibraryAsset, LibraryAssetUpdate } from '../types/library';

type WorldTarget = {
  value: string;
  label: string;
  sectionLabel: string;
  keys: string[];
  singleCollectionKey?: string;
  singular?: string;
};

type UndoSnapshot = {
  before: LibraryAssetUpdate;
  appliedUpdatedAt: string;
  sectionLabel: string;
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

function mergePatchValue(current: unknown, patch: unknown): unknown {
  if (isRecord(patch)) {
    const base = isRecord(current) ? current : {};
    const next: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) next[key] = mergePatchValue(base[key], value);
    return next;
  }

  if (Array.isArray(patch)) {
    const base = Array.isArray(current) ? current : [];
    const seen = new Set(base.map((item) => JSON.stringify(item)));
    return [...base, ...patch.filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })];
  }

  return patch;
}

function mergeWorldPatch(current: Record<string, unknown>, patch: Record<string, unknown>, target: WorldTarget) {
  const next: Record<string, unknown> = { ...current };

  if (target.singleCollectionKey) {
    const incoming = patch[target.singleCollectionKey];
    const first = Array.isArray(incoming) ? incoming[0] : undefined;
    if (!isRecord(first)) throw new Error(`Coda did not return one valid ${target.singular ?? 'entry'}.`);

    const existing = Array.isArray(current[target.singleCollectionKey]) ? current[target.singleCollectionKey] as unknown[] : [];
    const incomingName = typeof first.name === 'string' ? first.name.trim().toLowerCase() : '';
    if (incomingName && existing.some((item) => isRecord(item) && typeof item.name === 'string' && item.name.trim().toLowerCase() === incomingName)) {
      throw new Error(`A ${target.singular ?? 'record'} named “${first.name}” already exists. Coda did not save a duplicate.`);
    }

    next[target.singleCollectionKey] = [
      ...existing,
      { ...first, id: typeof first.id === 'string' && first.id ? first.id : crypto.randomUUID() },
    ];
    return next;
  }

  for (const key of target.keys) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = mergePatchValue(current[key], patch[key]);
  }
  return next;
}

function toUpdate(asset: LibraryAsset, document: Record<string, unknown>): LibraryAssetUpdate {
  const identity = isRecord(document.identity) ? document.identity : {};
  const identityName = typeof identity.name === 'string' ? identity.name.trim() : '';
  const identityDescription = typeof identity.description === 'string' ? identity.description.trim() : '';
  return {
    name: identityName || asset.name,
    summary: asset.summary.trim() ? asset.summary : identityDescription.slice(0, 2000),
    contentRating: asset.contentRating ?? 'sfw',
    tags: asset.tags,
    visualTone: asset.visualTone,
    document,
  };
}

function undoStorageKey(assetId: string) {
  return `orbis:coda-undo:${assetId}`;
}

function loadUndo(assetId: string): UndoSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(undoStorageKey(assetId));
    return raw ? JSON.parse(raw) as UndoSnapshot : null;
  } catch {
    return null;
  }
}

function saveUndo(assetId: string, snapshot: UndoSnapshot | null) {
  if (typeof window === 'undefined') return;
  if (!snapshot) window.sessionStorage.removeItem(undoStorageKey(assetId));
  else window.sessionStorage.setItem(undoStorageKey(assetId), JSON.stringify(snapshot));
}

export function CodaFileAssistant({ asset }: { asset: LibraryAsset }) {
  const [liveAsset, setLiveAsset] = useState(asset);
  const [text, setText] = useState('');
  const [history, setHistory] = useState<CodaHistoryTurn[]>([]);
  const [result, setResult] = useState<CodaAssistantResponse | null>(null);
  const [working, setWorking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [settingsPath, setSettingsPath] = useState('');
  const [applied, setApplied] = useState(false);
  const [appliedSection, setAppliedSection] = useState('');
  const [worldTarget, setWorldTarget] = useState('identity');
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(() => loadUndo(asset.id));

  const selectedWorldTarget = liveAsset.type === 'world'
    ? worldTargets.find((target) => target.value === worldTarget) ?? worldTargets[0]
    : undefined;

  const outsideScope = useMemo(
    () => (result?.proposals?.length ?? 0) + (result?.operations?.length ?? 0) > 0,
    [result],
  );

  const run = async () => {
    const input = text.trim();
    if (!input || working || applying) return;
    const target = selectedWorldTarget;
    const targetInstruction = target
      ? target.singleCollectionKey
        ? `\n- TARGET: ${target.label}. Draft exactly ONE new ${target.singular}.\n- recordPatch must contain ONLY the top-level key ${target.singleCollectionKey}, with exactly one new object inside its array.\n- Never echo, rewrite, or return the whole existing ${target.singleCollectionKey} collection. Existing entries are supplied only as a compact index so you can avoid duplicates.\n- If the user describes several entries, draft only the first/next one now. They can ask for the next entry in another turn.`
        : `\n- TARGET WORLD FORGE SECTION: ${target.label}. Put recordPatch changes ONLY under these existing top-level key(s): ${target.keys.join(', ')}. Do not include any other World Forge section.`
      : '';
    const compactContext = target ? compactWorldTargetContext(liveAsset, target) : '';

    setWorking(true);
    setError('');
    setSettingsPath('');
    setApplied(false);
    setAppliedSection('');
    try {
      const next = await askCoda({
        mode: 'sort',
        text: `${input}\n\nFILE-FOCUSED APPLY MODE:\n- Work only on the currently open ${liveAsset.type} file named ${liveAsset.name}.\n- Put changes for this file in recordPatch.\n- Do not create, update, save, or propose another record yourself. Orbis performs the write only after the human presses Apply to Orbis.\n- Do not change ownership, privacy, permissions, credentials, content rating, IDs, or other protected metadata.${targetInstruction}${compactContext ? `\n\nCOMPACT TARGET CONTEXT (reference only; do not copy it wholesale into the patch):\n${compactContext}` : ''}`,
        assetId: liveAsset.id,
        includeRecordContext: liveAsset.type !== 'world',
        pageHint: `File editor · type=${liveAsset.type} · name=${liveAsset.name} · target=${target?.label ?? 'current file'} · current_file_only`.slice(0, 120),
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
        setError(reason instanceof Error ? reason.message : 'Coda could not prepare that change.');
      }
    } finally {
      setWorking(false);
    }
  };

  const applyToServer = async () => {
    if (!result?.recordPatch || result.record?.id !== liveAsset.id || applying) return;
    if (document.querySelector('.editor-dirty.is-dirty')) {
      setError('Save or discard your manual World Forge changes before applying a Coda change. This prevents Coda from overwriting unsaved work.');
      return;
    }

    const target = selectedWorldTarget;
    const patch = target ? scopeWorldPatch(result.recordPatch, target) : result.recordPatch;
    if (!patch) {
      setError(`Coda did not return a valid ${target?.label ?? 'current-file'} patch. Nothing was saved.`);
      return;
    }

    setApplying(true);
    setError('');
    try {
      const current = await libraryApi.getAsset(liveAsset.id);
      const currentDocument = current.document ?? {};
      const nextDocument = current.type === 'world' && target
        ? mergeWorldPatch(currentDocument, patch, target)
        : mergePatchValue(currentDocument, patch) as Record<string, unknown>;

      if (JSON.stringify(nextDocument) === JSON.stringify(currentDocument)) {
        throw new Error('Coda did not produce a change to save.');
      }

      const before = toUpdate(current, currentDocument);
      const saved = await libraryApi.updateAsset(current.id, toUpdate(current, nextDocument));
      const snapshot: UndoSnapshot = {
        before,
        appliedUpdatedAt: saved.updatedAt,
        sectionLabel: target?.sectionLabel ?? '',
      };
      saveUndo(saved.id, snapshot);
      setUndoSnapshot(snapshot);
      setLiveAsset(saved);
      setApplied(true);
      setAppliedSection(target?.sectionLabel ?? '');
      setResult(null);
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Orbis could not save Coda’s change.');
    } finally {
      setApplying(false);
    }
  };

  const undoCodaChange = async () => {
    if (!undoSnapshot || applying) return;
    setApplying(true);
    setError('');
    try {
      const current = await libraryApi.getAsset(liveAsset.id);
      if (current.updatedAt !== undoSnapshot.appliedUpdatedAt) {
        saveUndo(current.id, null);
        setUndoSnapshot(null);
        throw new Error('Undo is no longer safe because this world changed after Coda’s last save.');
      }
      const restored = await libraryApi.updateAsset(current.id, undoSnapshot.before);
      saveUndo(restored.id, null);
      setUndoSnapshot(null);
      setLiveAsset(restored);
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Orbis could not undo Coda’s last change.');
    } finally {
      setApplying(false);
    }
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
      <strong>Coda is editing: {liveAsset.name}</strong>
      <dl>
        <div><dt>Type</dt><dd>{liveAsset.type}</dd></div>
        <div><dt>Record ID</dt><dd>{liveAsset.id}</dd></div>
        <div><dt>World</dt><dd>{liveAsset.type === 'world' ? liveAsset.name : liveAsset.originWorldName ?? liveAsset.originWorldId ?? 'Standalone'}</dd></div>
        <div><dt>Scope</dt><dd>{liveAsset.type === 'world' ? selectedWorldTarget?.label ?? 'World section' : 'current_file_only'}</dd></div>
      </dl>
      {liveAsset.type === 'world' && <label className="forge-field coda-file-target">
        <span>Coda target</span>
        <select value={worldTarget} disabled={working || applying} onChange={(event) => {
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
      <p>{liveAsset.type === 'world'
        ? 'Coda receives only the selected section plus a compact index. Review her change, then Apply to Orbis writes it directly to the server. One safe undo is kept for the last Coda save.'
        : 'Coda prepares a focused change for this record. Apply to Orbis writes it through the normal protected record save path.'}</p>
    </section>

    <div className="coda-file-transcript" aria-live="polite">
      {error && <div className="coda-file-notice is-error"><div><strong>{error}</strong>{settingsPath && <Link to={settingsPath}>Open Account settings</Link>}</div></div>}
      {undoSnapshot && <div className="coda-file-notice is-success"><div><strong>Last Coda change is saved{undoSnapshot.sectionLabel ? ` in ${undoSnapshot.sectionLabel}` : ''}.</strong><span>You can undo it until another edit changes this record.</span></div><button type="button" className="button button--secondary" disabled={applying} onClick={() => void undoCodaChange()}><Undo2 size={14} /> {applying ? 'Undoing...' : 'Undo Coda change'}</button></div>}
      {result?.summary && <p className="coda-file-summary">{result.summary}</p>}
      {result?.questions?.length ? <section><strong>Needs your answer</strong><ul>{result.questions.map((question) => <li key={question}>{question}</li>)}</ul></section> : null}
      {result?.warnings?.length ? <section><strong>Coda noticed</strong><ul>{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}
      {outsideScope && <div className="coda-file-notice"><div><strong>Out-of-scope suggestions ignored.</strong><span>Only the selected current-record patch can be applied.</span></div></div>}
      {result?.recordPatch ? <section className="coda-file-draft">
        <div><strong>Change ready</strong><small>Review Coda’s patch. Apply writes it directly to Orbis; it is no longer a local-only draft.</small></div>
        <details><summary>Preview JSON patch</summary><pre>{JSON.stringify(result.recordPatch, null, 2)}</pre></details>
        <button type="button" className="button button--primary" disabled={applying} onClick={() => void applyToServer()}>{applying ? 'Saving...' : `Apply to Orbis · ${selectedWorldTarget?.label ?? 'current file'}`}</button>
      </section> : result ? <div className="coda-file-notice"><BookOpen size={15} /><span>Coda did not return an editable patch for this file. Give her another instruction and keep it focused on the selected target.</span></div> : null}
      {applied && !undoSnapshot && <div className="coda-file-notice is-success"><div><strong>Saved to Orbis{appliedSection ? ` in ${appliedSection}` : ''}.</strong></div></div>}
    </div>

    <div className="coda-file-composer">
      {history.length > 0 && <div className="coda-file-thread"><span>{Math.floor(history.length / 2)} exchange{history.length === 2 ? '' : 's'}</span><button type="button" onClick={clear}><RotateCcw size={13} /> Clear</button></div>}
      <textarea
        rows={8}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={`Tell Coda what to add or edit in ${liveAsset.name}...`}
      />
      <button type="button" className="button button--primary" disabled={working || applying || !text.trim()} onClick={() => void run()}>
        <Send size={15} /> {working ? 'Coda is preparing...' : 'Ask Coda'}
      </button>
    </div>
  </aside>;
}
