import { Archive, ArrowLeft, Copy, Download, Eye, FileUp, Gamepad2, Pencil, Play, Plus, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { libraryApi } from '../api/client';
import { saveArchiveApi, type ArchivedSave, type SaveArchiveResponse } from '../api/save-archive';
import { useAuth } from '../auth/AuthContext';
import { PersonaPicker } from '../components/PersonaPicker';
import '../styles/save-archive.css';

const MAX_SAVE_BYTES = 16 * 1024 * 1024;
type SaveShelf = 'speculus' | 'fabula';

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

function canResume(save: ArchivedSave) {
  return save.compatibility === 'ready' && Boolean(save.personaId);
}

export function SaveArchiveView() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [archive, setArchive] = useState<SaveArchiveResponse | null>(null);
  const [activeShelf, setActiveShelf] = useState<SaveShelf>('speculus');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [launchSave, setLaunchSave] = useState<ArchivedSave | null>(null);
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

  const continueSave = async (save: ArchivedSave) => {
    if (!canResume(save) || !save.personaId || busy) return;
    setBusy(save.id); setError('');
    try {
      const launch = await libraryApi.simulateAsset(
        save.sourceAssetId,
        save.personaId,
        save.locationId ?? undefined,
        { resumeSaveId: save.id },
      );
      window.location.assign(launch.launchUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Speculus could not continue this session.');
      setBusy('');
    }
  };

  const openSource = async (save: ArchivedSave, personaId: string, startingPlaceId: string) => {
    if (save.compatibility !== 'ready' || busy) return;
    setBusy(save.id); setError('');
    try {
      const launch = await libraryApi.simulateAsset(save.sourceAssetId, personaId, startingPlaceId);
      window.location.assign(launch.launchUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Speculus could not start from this save source.');
      setBusy('');
    }
  };

  const reviewSave = (save: ArchivedSave) => {
    document.getElementById(`save-${save.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (!user) return <div className="page save-archive"><Link className="back-link" to={`/asset/${id}`}><ArrowLeft size={16} /> Back to world</Link><section className="save-archive__empty"><Archive size={36} /><h1>Save Archive</h1><p>Sign in with Discord to keep private saves in Orbis.</p><Link className="button button--primary" to="/account">Open Account</Link></section></div>;

  const latestResumable = archive?.saves.find(canResume) ?? null;

  return <div className="page save-archive">
    <Link className="back-link" to={`/asset/${id}`}><ArrowLeft size={16} /> Back to world</Link>
    <header className="save-archive__hero">
      <div><span className="eyebrow">Private world save archive</span><h1>{archive?.world.name ?? 'Save Archive'}</h1><p>Your Speculus sessions live here. Continue in one click, review older saves, or export a backup without needing to understand the storage machinery underneath.</p></div>
    </header>

    <nav className="save-archive__shelves" aria-label="Save archive type">
      <button type="button" className={activeShelf === 'speculus' ? 'is-active' : ''} aria-pressed={activeShelf === 'speculus'} onClick={() => setActiveShelf('speculus')}>
        <Sparkles size={20} />
        <span><strong>Speculus Saves</strong><small>Simulation sessions</small></span>
        {archive && <b>{archive.saves.length}</b>}
      </button>
      <button type="button" className={activeShelf === 'fabula' ? 'is-active' : ''} aria-pressed={activeShelf === 'fabula'} onClick={() => setActiveShelf('fabula')}>
        <Gamepad2 size={20} />
        <span><strong>Fabula Saves</strong><small>Persistent RPG campaigns</small></span>
        <b>Future</b>
      </button>
    </nav>

    {error && <p className="form-message" role="alert">{error}</p>}

    {launchSave && <PersonaPicker
      targetId={launchSave.sourceAssetId}
      targetName={launchSave.sourceName}
      initialPlaceId={launchSave.locationId ?? undefined}
      busy={busy === launchSave.id}
      error={error}
      onCancel={() => { if (!busy) { setLaunchSave(null); setError(''); } }}
      onSelect={(personaId, startingPlaceId) => void openSource(launchSave, personaId, startingPlaceId)}
    />}

    {activeShelf === 'fabula' ? <section className="save-archive__empty save-archive__future">
      <Gamepad2 size={42} />
      <span className="eyebrow">Reserved for Fabula</span>
      <h2>Fabula Save Library</h2>
      <p>This shelf is intentionally separate from Speculus. When Fabula is built, persistent campaigns, inventory, economy, travel, encounters and other RPG state will save here without changing the Speculus save format.</p>
      <span className="save-archive__future-badge">Placeholder · No Fabula saves yet</span>
    </section> : <>
      {latestResumable && <section className="save-recovery" aria-label="Continue latest Speculus session">
        <div className="save-recovery__icon"><Play size={28} /></div>
        <div className="save-recovery__copy">
          <span className="eyebrow">Session found</span>
          <h2>Continue where you left off</h2>
          <p><strong>{latestResumable.title}</strong> will reopen with its archived transcript and state after Orbis issues fresh Speculus authorization.</p>
          <div className="save-recovery__meta">
            <span>{latestResumable.personaName ?? 'Saved Persona'}</span>
            <span>{latestResumable.locationName ?? latestResumable.sourceName}</span>
            <span>Saved {new Date(latestResumable.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
          <div className="save-recovery__safe"><ShieldCheck size={15} /> Archived in Orbis · fresh authorization is issued when you continue</div>
        </div>
        <div className="save-recovery__actions">
          <button className="button button--primary" disabled={Boolean(busy)} onClick={() => void continueSave(latestResumable)}><Play size={16} /> {busy === latestResumable.id ? 'Opening...' : 'Continue Session'}</button>
          <button className="button button--secondary" disabled={Boolean(busy)} onClick={() => reviewSave(latestResumable)}><Eye size={16} /> Review save</button>
        </div>
      </section>}

      {loading && !archive && <section className="save-archive__empty"><Archive size={32} /><p>Opening your Speculus save shelf...</p></section>}
      {!loading && archive && archive.saves.length === 0 && <section className="save-archive__empty"><Archive size={38} /><h2>No Speculus saves archived yet</h2><p>When you archive a Speculus session or import one of your exported backups, it will appear here.</p></section>}

      {archive && archive.saves.length > 0 && <section className="save-shelf" aria-label="Speculus saves">
        {archive.saves.map((save, index) => <article id={`save-${save.id}`} className={`save-card save-card--${save.compatibility}`} key={save.id}>
          <div className="save-card__spine"><span>{String(index + 1).padStart(2, '0')}</span></div>
          <div className="save-card__body">
            <header><div><span className="eyebrow">Speculus · {save.locationName ?? save.sourceName}</span><h2>{save.title}</h2></div><span className={`save-status save-status--${save.compatibility}`}>{compatibilityLabel(save.compatibility)}</span></header>
            <div className="save-card__identity">
              <strong>{save.personaName ?? save.characterName ?? 'Simulation narrator'}</strong>
              <span>Day {save.simulationDay}</span>
              <span>{duration(save.elapsedSeconds)}</span>
              <span>{save.turnCount} {save.turnCount === 1 ? 'turn' : 'turns'}</span>
              <span>Saved {new Date(save.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </div>
            <p className="save-card__revision" title={save.sourceRevision}>Source: {save.sourceName} · revision {save.sourceRevision}</p>
            {!save.personaId && save.compatibility === 'ready' && <p className="save-card__note">This older save does not identify an Orbis Persona, so it can be reviewed or exported but cannot use one-click Continue.</p>}
            <footer>
              {canResume(save) && <button className="button button--primary" disabled={Boolean(busy)} onClick={() => void continueSave(save)}><Play size={15} /> {busy === save.id ? 'Opening...' : 'Continue session'}</button>}
              <button className="button button--secondary" disabled={save.compatibility !== 'ready' || Boolean(busy)} onClick={() => { setError(''); setLaunchSave(save); }} title="Choose a Persona and starting Place to begin a fresh session from this source."><Plus size={15} /> Start new session</button>
              <a className="button button--secondary" href={saveArchiveApi.downloadUrl(save.id)}><Download size={15} /> Export backup</a>
              <button className="icon-button" disabled={Boolean(busy)} onClick={() => void rename(save)} aria-label={`Rename ${save.title}`}><Pencil size={16} /></button>
              <button className="icon-button" disabled={Boolean(busy)} onClick={() => void duplicate(save)} aria-label={`Duplicate ${save.title}`}><Copy size={16} /></button>
              <button className="icon-button save-card__delete" disabled={Boolean(busy)} onClick={() => void remove(save)} aria-label={`Delete ${save.title}`}><Trash2 size={16} /></button>
            </footer>
          </div>
        </article>)}
      </section>}

      <section className="save-archive__import" aria-label="Import Speculus backup">
        <div className="save-archive__import-copy">
          <FileUp size={22} />
          <div><strong>Have a Speculus backup file?</strong><p>Import is optional. Use it only when you already exported a <code>.json</code> backup and want to put that session back into this archive.</p></div>
        </div>
        <button className="button button--secondary" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}><FileUp size={16} /> {busy === 'import' ? 'Importing...' : 'Import backup'}</button>
        <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => void importSave(event.target.files?.[0])} />
      </section>
    </>}
  </div>;
}
