import { ArrowLeft, Download, FileJson, PenLine, Sparkles, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { uploadArchive } from '../api/archive-transfer';
import { libraryApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  createBlankWorldAsset,
  parseWorldAuthoringJson,
  stringifyWorldAuthoringTemplate,
  type ParsedWorldJson,
} from '../features/library/world-json';
import { useSEO } from '../hooks/useSEO';

type WorldTransferPreview = {
  rootAssetId: string;
  name: string;
  records: number;
};

function downloadTemplate() {
  const blob = new Blob([stringifyWorldAuthoringTemplate()], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'orbis-world-template.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function worldCounts(result: ParsedWorldJson | null) {
  const document = result?.asset.document ?? {};
  const count = (key: string) => Array.isArray(document[key]) ? document[key].length : 0;
  return {
    places: count('locations'),
    species: count('species'),
    factions: count('factions'),
    societies: count('societies'),
    families: count('families'),
    memories: count('memories'),
  };
}

function worldTransferPreview(raw: string): WorldTransferPreview | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.format !== 'orbis-transfer' || parsed.version !== 1) return null;
    const scope = parsed.scope;
    const records = parsed.records;
    if (!scope || typeof scope !== 'object' || Array.isArray(scope) || !Array.isArray(records)) return null;
    const scopeRecord = scope as Record<string, unknown>;
    if (scopeRecord.kind !== 'world' || typeof scopeRecord.rootAssetId !== 'string') return null;
    const root = records.find((record) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
      const item = record as Record<string, unknown>;
      return item.id === scopeRecord.rootAssetId && item.type === 'world';
    }) as Record<string, unknown> | undefined;
    if (!root) return null;
    return {
      rootAssetId: scopeRecord.rootAssetId,
      name: typeof root.name === 'string' && root.name.trim() ? root.name.trim() : 'World archive',
      records: records.length,
    };
  } catch {
    return null;
  }
}

export function CreateWorldView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(searchParams.get('import') === '1');
  const [rawJson, setRawJson] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ParsedWorldJson | null>(null);
  const [transferPreview, setTransferPreview] = useState<WorldTransferPreview | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState<'manual' | 'coda' | 'import' | 'archive' | ''>('');
  const counts = useMemo(() => worldCounts(preview), [preview]);

  useSEO({
    title: 'Create World | Orbis',
    description: 'Create an Orbis world manually, with Coda, or from a JSON draft.',
    canonicalPath: '/worlds/new',
  });

  const createBlank = async (withCoda: boolean) => {
    if (working) return;
    setWorking(withCoda ? 'coda' : 'manual');
    setError('');
    try {
      const world = await libraryApi.createAsset(createBlankWorldAsset());
      navigate(`/asset/${world.id}/edit${withCoda ? '?coda=1' : ''}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Orbis could not create the world.');
      setWorking('');
    }
  };

  const validateJson = (value = rawJson) => {
    setError('');
    const transfer = worldTransferPreview(value);
    if (transfer) {
      setPreview(null);
      setTransferPreview(transfer);
      return null;
    }
    setTransferPreview(null);
    try {
      const result = parseWorldAuthoringJson(value);
      setPreview(result);
      return result;
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : 'Orbis could not read this JSON.');
      return null;
    }
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    setError('');
    setPreview(null);
    setTransferPreview(null);
    if (file.size > 2_000_000) {
      setError('This JSON file is larger than 2 MB. Use Account → Upload archive for large multi-record backups.');
      return;
    }
    try {
      const text = await file.text();
      setFileName(file.name);
      setRawJson(text);
      validateJson(text);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Orbis could not read that file.');
    }
  };

  const createImportedWorld = async () => {
    if (working) return;
    const result = validateJson();
    if (!result) return;
    setWorking('import');
    try {
      const world = await libraryApi.createAsset(result.asset);
      navigate(`/asset/${world.id}/edit`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Orbis could not create the imported world.');
      setWorking('');
    }
  };

  const restoreWorldArchive = async () => {
    if (working || !transferPreview) return;
    setWorking('archive');
    setError('');
    try {
      const archive = new File(
        [rawJson],
        fileName || `${transferPreview.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'world'}.orbis.json`,
        { type: 'application/octet-stream' },
      );
      await uploadArchive(archive);
      navigate(`/asset/${transferPreview.rootAssetId}/edit`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Orbis could not restore this world archive.');
      setWorking('');
    }
  };

  if (authLoading) return <div className="page world-create-page"><p className="world-create-muted">Checking creator access...</p></div>;

  if (!user) {
    return <div className="page world-create-page">
      <Link className="back-link" to="/library/world"><ArrowLeft size={16} /> Back to Worlds</Link>
      <section className="world-create-empty">
        <h1>Sign in to create a world</h1>
        <p>Orbis needs your account so ownership stays attached to the world you create.</p>
      </section>
    </div>;
  }

  return <div className="page world-create-page">
    <Link className="back-link" to="/library/world"><ArrowLeft size={16} /> Back to Worlds</Link>

    <header className="world-create-hero">
      <span className="eyebrow">World creation</span>
      <h1>How do you want to start?</h1>
      <p>All three paths end in the same Orbis World Forge. Pick the amount of help you want.</p>
    </header>

    {error && <div className="inline-error world-create-error" role="alert">{error}</div>}

    <section className="world-create-options" aria-label="World creation methods">
      <article className="world-create-card" id="manual">
        <div className="world-create-card__icon"><PenLine size={22} /></div>
        <div><span className="eyebrow">Manual</span><h2>Start with a blank world</h2><p>Use the existing World Forge tabs and fields. Nothing changes about the manual workflow.</p></div>
        <button className="button button--primary" type="button" disabled={Boolean(working)} onClick={() => void createBlank(false)}>
          {working === 'manual' ? 'Creating...' : 'Create manually'}
        </button>
      </article>

      <article className="world-create-card world-create-card--coda" id="coda">
        <div className="world-create-card__icon"><Sparkles size={22} /></div>
        <div><span className="eyebrow">Coda assisted</span><h2>Create with Coda</h2><p>Open a private blank world in the editor, then use Coda on that open file. Her draft stays unsaved until you press Save in the World Forge.</p></div>
        <button className="button button--primary" type="button" disabled={Boolean(working)} onClick={() => void createBlank(true)}>
          {working === 'coda' ? 'Preparing Coda...' : 'Create with Coda'}
        </button>
      </article>

      <article className="world-create-card" id="import-json">
        <div className="world-create-card__icon"><FileJson size={22} /></div>
        <div><span className="eyebrow">JSON</span><h2>Import a JSON draft</h2><p>Load a World JSON file, validate it locally, review the detected structure, then explicitly create it in Orbis.</p></div>
        <button className="button button--secondary" type="button" disabled={Boolean(working)} onClick={() => setImportOpen((open) => !open)}>
          <Upload size={16} /> {importOpen ? 'Close importer' : 'Import JSON'}
        </button>
      </article>
    </section>

    {importOpen && <section className="world-json-import">
      <header className="world-json-import__header">
        <div><span className="eyebrow">JSON draft importer</span><h2>Review before anything is saved</h2><p>The file is parsed in your browser first. Orbis does not create the world until you press the matching import button below.</p></div>
        <button className="button button--secondary" type="button" onClick={downloadTemplate}><Download size={16} /> Download blank template</button>
      </header>

      <div className="world-json-import__toolbar">
        <input ref={fileInputRef} className="world-json-import__file" type="file" accept=".json,.orbis.json,application/json,application/octet-stream" onChange={(event) => void loadFile(event.target.files?.[0])} />
        <button className="button button--secondary" type="button" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> Choose JSON file</button>
        <button className="button button--secondary" type="button" onClick={() => { setRawJson(stringifyWorldAuthoringTemplate()); setFileName('orbis-world-template.json'); setPreview(null); setTransferPreview(null); setError(''); }}>Load blank template here</button>
        {fileName && <span className="world-json-import__filename">{fileName}</span>}
      </div>

      <label className="world-json-import__editor">
        <span>World JSON</span>
        <textarea
          value={rawJson}
          rows={22}
          spellCheck={false}
          placeholder="Choose a .json file, paste a World JSON document, or load the blank template."
          onChange={(event) => { setRawJson(event.target.value); setPreview(null); setTransferPreview(null); setError(''); }}
        />
      </label>

      <div className="world-json-import__actions">
        <button className="button button--secondary" type="button" disabled={!rawJson.trim() || Boolean(working)} onClick={() => validateJson()}>Validate draft</button>
        {transferPreview
          ? <button className="button button--primary" type="button" disabled={Boolean(working)} onClick={() => void restoreWorldArchive()}>{working === 'archive' ? 'Restoring...' : 'Restore world archive'}</button>
          : <button className="button button--primary" type="button" disabled={!preview || Boolean(working)} onClick={() => void createImportedWorld()}>{working === 'import' ? 'Creating...' : 'Create world from JSON'}</button>}
      </div>

      {error && <div className="inline-error world-create-error" role="alert">{error}</div>}

      {transferPreview && <section className="world-json-preview">
        <div><span>Detected format</span><strong>orbis-transfer</strong></div>
        <div><span>World</span><strong>{transferPreview.name}</strong></div>
        <div><span>Records</span><strong>{transferPreview.records}</strong></div>
        <p>This is a full Orbis world archive, not a draft. Restoring it preserves its original record IDs, world links and SPC identities. If those exact records already exist on this Orbis server, the restore will stop instead of overwriting them.</p>
      </section>}

      {preview && <section className="world-json-preview">
        <div><span>Detected format</span><strong>{preview.format}</strong></div>
        <div><span>World</span><strong>{preview.asset.name}</strong></div>
        <div><span>Rating</span><strong>{preview.asset.contentRating ?? 'sfw'}</strong></div>
        <div><span>Places</span><strong>{counts.places}</strong></div>
        <div><span>Species</span><strong>{counts.species}</strong></div>
        <div><span>Factions</span><strong>{counts.factions}</strong></div>
        <div><span>Societies</span><strong>{counts.societies}</strong></div>
        <div><span>Families</span><strong>{counts.families}</strong></div>
        <div><span>Memories</span><strong>{counts.memories}</strong></div>
        <p>{preview.warning}</p>
      </section>}

      <aside className="world-json-help">
        <strong>Howling Whispers JSON rule</strong>
        <p>The outer fields tell Orbis what the file is. A World draft uses a <code>data</code> object for the editable World document. A full <code>orbis-transfer</code> world archive is detected separately and can be restored from this same importer. Documentation may show <code>//</code> comments for teaching, but comments are not valid inside real JSON files.</p>
      </aside>
    </section>}
  </div>;
}
