import { BookOpen, RotateCcw, Send, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { askCoda, CodaAssistantError, type CodaAssistantResponse, type CodaHistoryTurn } from '../api/coda-assistant';
import type { LibraryAsset } from '../types/library';

function historyText(result: CodaAssistantResponse) {
  return JSON.stringify({
    summary: result.summary ?? '',
    questions: result.questions ?? [],
    warnings: result.warnings ?? [],
    recordPatch: result.recordPatch ?? null,
  }).slice(0, 60_000);
}

export function CodaFileAssistant({ asset }: { asset: LibraryAsset }) {
  const [text, setText] = useState('');
  const [history, setHistory] = useState<CodaHistoryTurn[]>([]);
  const [result, setResult] = useState<CodaAssistantResponse | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [settingsPath, setSettingsPath] = useState('');
  const [applied, setApplied] = useState(false);

  const outsideScope = useMemo(
    () => (result?.proposals?.length ?? 0) + (result?.operations?.length ?? 0) > 0,
    [result],
  );

  const run = async () => {
    const input = text.trim();
    if (!input || working) return;
    setWorking(true);
    setError('');
    setSettingsPath('');
    setApplied(false);
    try {
      const next = await askCoda({
        mode: 'sort',
        text: `${input}\n\nFILE-FOCUSED DRAFT MODE:\n- Work only on the currently open ${asset.type} file named ${asset.name}.\n- Put changes for this file in recordPatch.\n- Do not create, update, save, or propose another record.\n- Do not change ownership, privacy, permissions, credentials, content rating, IDs, or other protected metadata.\n- This is an unsaved draft. The human will review it and press Save in Orbis.`,
        assetId: asset.id,
        includeRecordContext: true,
        pageHint: `File editor · type=${asset.type} · name=${asset.name} · scope=current_file_only`,
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
    window.dispatchEvent(new CustomEvent('orbis:coda-apply-draft', {
      detail: { assetId: asset.id, patch: result.recordPatch },
    }));
    setApplied(true);
  };

  const clear = () => {
    setHistory([]);
    setResult(null);
    setText('');
    setError('');
    setSettingsPath('');
    setApplied(false);
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
        <button type="button" className="button button--primary" onClick={applyDraft}>Load draft into open file</button>
      </section> : result ? <div className="coda-file-notice"><BookOpen size={15} /><span>Coda did not return an editable patch for this file. Give her another instruction and keep it focused on the open record.</span></div> : null}
      {applied && <div className="coda-file-notice is-success"><div><strong>Draft loaded locally.</strong><span>Nothing has been saved yet. Review the editor and press Save yourself.</span></div></div>}
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
