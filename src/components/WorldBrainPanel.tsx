import { useEffect, useMemo, useState } from 'react';
import { getWorldBrain, publishWorldBrain, selectWorldBrain, type WorldBrainRevision, type WorldBrainState } from '../api/world-brain';

export function WorldBrainPanel({ worldId }: { worldId: string }) {
  const [state, setState] = useState<WorldBrainState | null>(null);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    void getWorldBrain(worldId).then((value) => {
      if (!active) return;
      setState(value);
      const effective = value.revisions.find((revision) => revision.id === value.selectedRevisionId) ?? value.revisions[0];
      setSelected(effective?.id ?? '');
      setDraft(effective?.source ?? '');
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'World Brain unavailable.'); });
    return () => { active = false; };
  }, [worldId]);

  const revisions = state?.revisions ?? [];
  const selectedRevision = useMemo<WorldBrainRevision | undefined>(() => revisions.find((revision) => revision.id === selected), [revisions, selected]);

  const publish = async () => {
    if (!draft.trim()) return setMessage('Write a World Brain draft before publishing.');
    setBusy(true); setMessage('');
    try {
      const result = await publishWorldBrain(worldId, draft, notes);
      setState((current) => current ? {
        ...current,
        mode: 'custom',
        selectedRevisionId: result.selectedRevisionId,
        revisions: [result.revision, ...current.revisions],
      } : current);
      setSelected(result.selectedRevisionId);
      setNotes('');
      setMessage(`Published revision ${result.revision.revisionNumber} and made it effective.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not publish the World Brain.'); }
    finally { setBusy(false); }
  };

  const useRevision = async () => {
    if (!selected) return;
    setBusy(true); setMessage('');
    try {
      await selectWorldBrain(worldId, { mode: 'custom', revisionId: selected });
      setState((current) => current ? { ...current, mode: 'custom', selectedRevisionId: selected } : current);
      setDraft(selectedRevision?.source ?? draft);
      setMessage(`Revision ${selectedRevision?.revisionNumber ?? ''} is now the effective World Brain.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not select the World Brain revision.'); }
    finally { setBusy(false); }
  };

  const useStandard = async () => {
    setBusy(true); setMessage('');
    try {
      await selectWorldBrain(worldId, { mode: 'standard' });
      setState((current) => current ? { ...current, mode: 'standard', selectedRevisionId: null } : current);
      setMessage('This world now uses the Standard World Brain. Custom revision history was preserved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not select the Standard World Brain.'); }
    finally { setBusy(false); }
  };

  const loadSelectedAsDraft = () => {
    if (!selectedRevision) return;
    setDraft(selectedRevision.source);
    setNotes('');
    setMessage(`Loaded revision ${selectedRevision.revisionNumber} into the editable draft. Publishing will create a new immutable revision.`);
  };

  return <section className="forge-module">
    <header className="forge-module__title">
      <div><span className="eyebrow">World Module 10</span><h2>World Brain</h2></div>
      <small>BEHAVIOR · AUTONOMY · SIMULATION CONSTITUTION</small>
    </header>

    <div className="forge-inheritance"><span className="forge-lamp" /><div>
      <strong>Effective brain: {state?.mode === 'custom' ? `Custom revision ${revisions.find((revision) => revision.id === state.selectedRevisionId)?.revisionNumber ?? '?'}` : 'Standard World Brain'}</strong>
      <p>Orbis owns the authored, versioned brain. Speculus V3, and later Fabula, executes the pinned effective revision. Characters remain data interpreted by this one world-level brain.</p>
    </div></div>

    <section className="forge-form-section">
      <h4>Published revisions</h4>
      {revisions.length ? <div className="forge-grid forge-grid--3">
        <label className="forge-field"><span>Revision</span><select value={selected} onChange={(event) => setSelected(event.target.value)}>
          {revisions.map((revision) => <option key={revision.id} value={revision.id}>Revision {revision.revisionNumber} · {new Date(revision.publishedAt).toLocaleString()}</option>)}
        </select></label>
        <div className="forge-field"><span>Selection</span><button type="button" className="button button--secondary" disabled={busy || !selected} onClick={() => void useRevision()}>Use selected revision</button></div>
        <div className="forge-field"><span>Draft</span><button type="button" className="button button--secondary" disabled={!selectedRevision} onClick={loadSelectedAsDraft}>Load as new draft</button></div>
      </div> : <p className="forge-empty">No custom World Brain revisions have been published for this world.</p>}
      {selectedRevision?.notes && <p className="forge-card-copy"><strong>Revision notes:</strong> {selectedRevision.notes}</p>}
      <button type="button" className="button button--secondary" disabled={busy || state?.mode === 'standard'} onClick={() => void useStandard()}>Use Standard World Brain</button>
      <small>Switching to Standard never deletes custom revision history.</small>
    </section>

    <section className="forge-form-section">
      <h4>Editable draft</h4>
      <label className="forge-field"><span>World Brain source</span><textarea rows={18} maxLength={1_000_000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Define how this world's simulation thinks, perceives, prioritizes, behaves and renders. Deterministic state rules remain runtime-owned." /></label>
      <label className="forge-field"><span>Revision notes</span><textarea rows={3} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What changed in this revision?" /></label>
      <button type="button" className="button button--primary" disabled={busy || !draft.trim()} onClick={() => void publish()}>{busy ? 'Publishing...' : 'Publish new revision'}</button>
      <small>Published revisions are immutable. Edit the draft and publish again to create the next revision.</small>
    </section>

    {message && <p className="form-message" role="status">{message}</p>}
  </section>;
}
