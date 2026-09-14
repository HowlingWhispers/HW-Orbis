import { Archive, ArrowLeft, Copy, Download, FileUp, Pencil, Play, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { libraryApi } from '../api/client';
import { saveArchiveApi, type ArchivedSave, type SaveArchiveResponse } from '../api/save-archive';
import { useAuth } from '../auth/AuthContext';
import '../styles/save-archive.css';

const MAX_SAVE_BYTES = 16 * 1024 * 1024;

function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m elapsed`;
  return `${Math.max(0, minutes)}m elapsed`;
}

function compatibilityLabel(value: ArchivedSave['compatibility']) {
  if (value === 'ready') return 'Ready';
  if (value === 'historical-revision-required') return 'Historical revision required';
  return 'Incompatible';
}

export function SaveArchiveView() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [archive, setArchive] = useState<SaveArchiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async (signal?: AbortSignal) => {
    try {
      setLoading(true); setError('');
      setArchive(await saveArchiveApi.list(id, signal));
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Orbis could not open the save archive.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [id]);

  const importSave = async (file?: File) => {
    if (!file || busy) return;
    if (file.size > MAX_SAVE_BYTES) { setError('That save is larger than the 16 MB archive limit.'); return; }
    setBusy('import'); setError('');
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as unknown;
      await saveArchiveApi.upload(id, parsed);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Orbis could not import that save.');
    } finally {
      setBusy('');
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const rename = async (save: ArchivedSave) => {
    const title = window.prompt('Rename this save:', save.title)?.trim();
    if (!title || title === save.title) return;
    setBusy(save.id); setError('');
    try { await saveArchiveApi.rename(save.id, title); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Orbis could not rename that save.'); }
    finally { setBusy(''); }
  };

  const duplicate = async (save: ArchivedSave) => {
    setBusy(save.id); setError('');
    try { await saveArchiveApi.duplicate(save.id); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Orbis could not duplicate that save.'); }
    finally { setBusy(''); }
  };

  const remove = async (save: ArchivedSave) => {
    if (!window.confirm(`Delete “${save.title}” from your archive?`)) return;
    setBusy(save.id); setError('');
    try { await saveArchiveApi.remove(save.id); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Orbis could not delete that save.'); }
    finally { setBusy(''); }
  };

  const openSource = async (save: ArchivedSave) => {
    if (save.compatibility !== 'ready' || busy) return;
    setBusy(save.id); setError('');
    try {
      const launch = await libraryApi.simulateAsset(save.sourceAssetId);
      window.location.assign(launch.launchUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Speculus could not start from this save source.');
      setBusy('');
    }
  };

  if (!user) return <div className="page save-archive"><Link className="back-link" to={`/asset/${id}`}><ArrowLeft size={16} /> Back to world</Link><section className="save-archive__empty"><Archive size={36} /><h1>Save Archive</h1><p>Sign in with Discord to keep private Speculus saves in Orbis.</p><Link className="button button--primary" to="/account">Open Account</Link></section></div>;

  return <div className="page save-archive">
    <Link className="back-link" to={`/asset/${id}`}><ArrowLeft size={16} /> Back to world</Link>
    <header className="save-archive__hero">
      <div><span className="eyebrow">Private simulation shelf</span><h1>{archive?.world.name ?? 'Save Archive'}</h1><p>Every save remembers its source revision, character, location, simulation day and elapsed time.</p></div>
      <div>
        <button className="button button--primary" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}><FileUp size={16} /> {busy === 'import' ? 'Importing...' : 'Import save'}</button>
        <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => void importSave(event.target.files?.[0])} />
      </div>
    </header>

    {error && <p className="form-message" role="alert">{error}</p>}
    {loading && !archive && <section className="save-archive__empty"><Archive size={32} /><p>Opening your save shelf...</p></section>}
    {!loading && archive && archive.saves.length === 0 && <section className="save-archive__empty"><Archive size={38} /><h2>No saves archived yet</h2><p>Import a Speculus V2 raw save and Orbis will identify its source and revision for you.</p></section>}

    {archive && archive.saves.length > 0 && <section className="save-shelf" aria-label="Archived saves">
      {archive.saves.map((save, index) => <article className={`save-card save-card--${save.compatibility}`} key={save.id}>
        <div className="save-card__spine"><span>{String(index + 1).padStart(2, '0')}</span></div>
        <div className="save-card__body">
          <header><div><span className="eyebrow">{save.locationName ?? save.sourceName}</span><h2>{save.title}</h2></div><span className={`save-status save-status--${save.compatibility}`}>{compatibilityLabel(save.compatibility)}</span></header>
          <div className="save-card__identity">
            <strong>{save.characterName ?? 'Simulation narrator'}</strong>
            <span>Day {save.simulationDay}</span>
            <span>{duration(save.elapsedSeconds)}</span>
            <span>{save.turnCount} {save.turnCount === 1 ? 'turn' : 'turns'}</span>
            <span>Saved {new Date(save.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
          <p className="save-card__revision" title={save.sourceRevision}>Source: {save.sourceName} · revision {save.sourceRevision}</p>
          <footer>
            <button className="button button--secondary" disabled={save.compatibility !== 'ready' || Boolean(busy)} onClick={() => void openSource(save)} title="Launch the matching source in Speculus. Automatic archive-state handoff is the next bridge step."><Play size={15} /> Open in Speculus</button>
            <a className="button button--secondary" href={saveArchiveApi.downloadUrl(save.id)}><Download size={15} /> Download</a>
            <button className="icon-button" disabled={Boolean(busy)} onClick={() => void rename(save)} aria-label={`Rename ${save.title}`}><Pencil size={16} /></button>
            <button className="icon-button" disabled={Boolean(busy)} onClick={() => void duplicate(save)} aria-label={`Duplicate ${save.title}`}><Copy size={16} /></button>
            <button className="icon-button save-card__delete" disabled={Boolean(busy)} onClick={() => void remove(save)} aria-label={`Delete ${save.title}`}><Trash2 size={16} /></button>
          </footer>
        </div>
      </article>)}
    </section>}
  </div>;
}
