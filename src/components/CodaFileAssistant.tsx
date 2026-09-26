import { BookOpen, RotateCcw, Send, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { askCoda, CodaAssistantError, type CodaAssistantResponse, type CodaHistoryTurn } from '../api/coda-assistant';
import type { LibraryAsset } from '../types/library';

const worldSectionKeys: Array<{ label: string; keys: string[] }> = [
  { label: 'Identity', keys: ['identity'] },
  { label: 'Lore', keys: ['lore'] },
  { label: 'Places', keys: ['locations'] },
  { label: 'Species & Factions', keys: ['species', 'factions'] },
  { label: 'Peoples & Societies', keys: ['societies'] },
  { label: 'Family Trees', keys: ['families'] },
  { label: 'Memory & Timeline', keys: ['memories'] },
  { label: 'Rules', keys: ['rules'] },
  { label: 'Time & Weather', keys: ['timeWeather'] },
  { label: 'World Brain', keys: ['brain', 'worldBrain'] },
];

function historyText(result: CodaAssistantResponse) {
  return JSON.stringify({
    summary: result.summary ?? '',
    questions: result.questions ?? [],
    warnings: result.warnings ?? [],
    recordPatch: result.recordPatch ?? null,
  }).slice(0, 60_000);
}

function currentWorldForgeSection() {
  const active = document.querySelector<HTMLButtonElement>('.forge-tabs button.is-active');
  return active?.textContent?.trim() ?? '';
}

function patchHasKey(patch: unknown, key: string) {
  return Boolean(patch) && typeof patch === 'object' && !Array.isArray(patch)
    && Object.prototype.hasOwnProperty.call(patch, key);
}

function targetWorldForgeSection(patch: unknown, currentSection: string) {
  const current = worldSectionKeys.find((section) => section.label === currentSection);
  if (current?.keys.some((key) => patchHasKey(patch, key))) return current.label;
  return worldSectionKeys.find((section) => section.keys.some((key) => patchHasKey(patch, key)))?.label ?? '';
}

function scopeWorldPatch(patch: unknown, sectionLabel: string) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const section = worldSectionKeys.find((entry) => entry.label === sectionLabel);
  if (!section) return patch;
  const source = patch as Record<string, unknown>;
  const scoped = Object.fromEntries(
    section.keys
      .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
      .map((key) => [key, source[key]]),
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
  const [worldTarget, setWorldTarget] = useState('auto');

  const outsideScope = useMemo(
    () => (result?.proposals?.length ?? 0) + (result?.operations?.length ?? 0) > 0,
    [result],
  );

  const run = async () => {
    const input = text.trim();
    if (!input || working) return;
    const openSection = asset.type === 'world' ? currentWorldForgeSection() : '';
    const requestedSection = asset.type === 'world'
      ? (worldTarget === 'auto' ? openSection : worldTarget)
      : '';
    const requestedDefinition = worldSectionKeys.find((section) => section.label === requestedSection);
    const targetInstruction = requestedDefinition
      ? `\n- TARGET WORLD FORGE SECTION: ${requestedDefinition.label}. Put recordPatch changes ONLY under these existing top-level key(s): ${requestedDefinition.keys.join(', ')}. Do not include Identity or any other section unless Identity itself is the selected target.`
      : '';

    setWorking(true);
    setError('');
    setSettingsPath('');
    setApplied(false);
    setAppliedSection('');
    try {
      const next = await askCoda({
        mode: 'sort',
        text: `${input}\n\nFILE-FOCUSED DRAFT MODE:\n- Work only on the currently open ${asset.type} file named ${asset.name}.\n- Put changes for this file in recordPatch.\n- Do not create, update, save, or propose another record.\n- Do not change ownership, privacy, permissions, credentials, content rating, IDs, or other protected metadata.\n- This is an unsaved draft. The human will review it and press Save in Orbis.${targetInstruction}`,
        assetId: asset.id,
        includeRecordContext: true,
        pageHint: `File editor · type=${asset.type} · name=${asset.name} · section=${requestedSection || 'n/a'} · current_file_only`.slice(0, 120),
        history,
      });
      setResult(next);
      setHistory((current) => [
        ...current,
        { role: 'user' as const, content: input },
        { role: 'assistant' as const, content: historyText(next) },
      ].slice(-8));
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
    const openSection = asset.type === 'world' ? currentWorldForgeSection() : '';
    const explicitSection = asset.type === 'world' && worldTarget !== 'auto' ? worldTarget : '';
    const targetSection = asset.type === 'world'
      ? (explicitSection || targetWorldForgeSection(result.recordPatch, openSection))
      : '';
    const patch = explicitSection ? scopeWorldPatch(result.recordPatch, explicitSection) : result.recordPatch;

    if (!patch) {
      setError(`Coda did not return a ${explicitSection} patch. Nothing was loaded. Ask her to draft that section again.`);
      setApplied(false);
      setAppliedSection('');
      return;
    }

    window.dispatchEvent(new CustomEvent('orbis:coda-apply-draft', {
      detail: { assetId: asset.id, patch, preferredSection: targetSection },
    }));
    focusWorldForgeSection(targetSection);
    setError('');
    setAppliedSection(targetSection);
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
        <div><dt>Scope</dt><dd>current_file_only</dd></div>
      </dl>
      {asset.type === 'world' && <label className="forge-field coda-file-target">
        <span>Coda target section</span>
        <select value={worldTarget} disabled={working} onChange={(event) => { setWorldTarget(event.target.value); setApplied(false); setAppliedSection(''); setError(''); }}>
          <option value="auto">Follow the open World Forge tab</option>
          {worldSectionKeys.map((section) => <option key={section.label} value={section.label}>{section.label}</option>)}
        </select>
        <small>Pick exactly where Coda may place her next draft. An explicit choice is enforced when the draft is loaded.</small>
      </label>}
      <p>The open file is sent to your configured NovelAI provider so Coda can draft against its real structure. Coda cannot save this panel's draft.</p>
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
        <button type="button" className="button button--primary" onClick={applyDraft}>Load draft into {asset.type === 'world' && worldTarget !== 'auto' ? worldTarget : 'open file'}</button>
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
