import { Archive, ArrowLeft, Boxes, Clock3, Download, MapPin, Pencil, Sparkles, Trash2, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { libraryApi } from '../api/client';
import type { DeleteImpact } from '../api/contracts';
import { downloadRecordArchive } from '../api/archive-transfer';
import { useAuth } from '../auth/AuthContext';
import { findNavigationItem } from '../app/library-nav';
import { ErrorState, LoadingState } from '../components/StatePanel';
import { useLibraryData } from '../hooks/useLibraryData';
import { useSEO } from '../hooks/useSEO';

type DocumentRecord = Record<string, unknown>;

export function AssetDetailView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteImpact, setDeleteImpact] = useState<DeleteImpact | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const { data: asset, error, loading, retry } = useLibraryData((signal) => libraryApi.getAsset(id, signal), [id]);

  useEffect(() => {
    const resetSimulationLaunch = () => {
      setLaunching(false);
      setLaunchError('');
    };
    window.addEventListener('pageshow', resetSimulationLaunch);
    return () => window.removeEventListener('pageshow', resetSimulationLaunch);
  }, []);

  const category = asset ? findNavigationItem(asset.type) : undefined;
  const canonicalPath = `/asset/${id}`;
  const recordType = category?.label.toLowerCase() ?? 'library';

  useSEO({
    title: asset ? `${asset.name} | ${category?.label} | Orbis — Library of Howling Whispers` : 'Orbis — Library of Howling Whispers',
    description: asset?.summary || (asset ? `View ${asset.name}, a ${recordType} record in Orbis, the Library of Howling Whispers. Canonical worldbuilding record connected to the Howling Whispers ecosystem.` : 'Opening an Orbis library record.'),
    canonicalPath,
    ogType: 'article',
    noindex: !asset,
    structuredData: asset ? {
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: asset.name,
      description: asset.summary || `A ${recordType} record in Orbis.`,
      url: `https://lib.thehowlingwhispers.com${canonicalPath}`,
      creator: asset.author ? {
        '@type': 'Person',
        name: asset.author.displayName,
      } : undefined,
      publisher: {
        '@type': 'Organization',
        name: 'Howling Whispers',
        url: 'https://thehowlingwhispers.com/',
      },
      datePublished: asset.createdAt,
      dateModified: asset.updatedAt,
      keywords: asset.tags.length > 0 ? asset.tags.join(', ') : undefined,
      isPartOf: {
        '@type': 'WebSite',
        name: 'Orbis',
        url: 'https://lib.thehowlingwhispers.com/',
      },
    } : undefined,
  });

  if (loading) return <div className="page"><LoadingState label="Opening the record..." /></div>;
  if (error || !asset) return <div className="page"><ErrorState retry={retry} /></div>;

  const Icon = category?.icon;
  const canEdit = user && asset.canEdit === true;

  const simulate = async () => {
    if (!user) { navigate('/account'); return; }
    setLaunching(true); setLaunchError('');
    try {
      const launch = await libraryApi.simulateAsset(asset.id);
      window.location.assign(launch.launchUrl);
    } catch (reason) {
      setLaunchError(reason instanceof Error ? reason.message : 'Speculus could not start.');
      setLaunching(false);
    }
  };

  const reviewDeleteWorld = async () => {
    if (!canEdit || asset.type !== 'world' || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const impact = await libraryApi.getDeleteImpact(asset.id);
      setDeleteImpact(impact);
      setDeleteConfirmation('');
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : 'Orbis could not inspect this world for deletion.');
    } finally {
      setDeleting(false);
    }
  };

  const deleteWorld = async () => {
    if (!canEdit || asset.type !== 'world' || deleting || !deleteImpact) return;
    const expected = `DELETE ${asset.name}`;
    if (deleteConfirmation !== expected) return;

    setDeleting(true);
    setDeleteError('');
    try {
      await libraryApi.deleteAsset(asset.id, {
        cascade: deleteImpact.totalChildren > 0,
        confirmName: asset.name,
      });
      navigate('/library/world', { replace: true });
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : 'Orbis could not delete this world.');
      setDeleting(false);
    }
  };

  const download = async () => {
    if (!canEdit || downloading) return;
    setDownloading(true); setDownloadError('');
    try { await downloadRecordArchive(asset.id); }
    catch (reason) { setDownloadError(reason instanceof Error ? reason.message : 'Orbis could not download this SPC record.'); }
    finally { setDownloading(false); }
  };

  return (
    <div className="page detail-page">
      <Link className="back-link" to={`/library/${asset.type}`}><ArrowLeft size={16} /> Back to {category?.label}</Link>
      <section className={`detail-hero tone-${asset.visualTone}`}>
        <div className="detail-hero__art"><span className="visual-orb" /><span className="visual-ridge visual-ridge--back" /><span className="visual-ridge visual-ridge--front" /></div>
        <div className="detail-hero__copy">
          <span className="eyebrow">{Icon && <Icon size={14} />} {category?.shortLabel} record</span>
          <h1>{asset.name}</h1>
          <p>{asset.summary}</p>
          {asset.tags.length > 0 && <div className="detail-hero__tags tag-row tag-row--large">{asset.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
          <div className="detail-actions">
            {canEdit
              ? <Link className="button button--primary" to={`/asset/${asset.id}/edit`}><Pencil size={16} /> Edit record</Link>
              : <button className="button button--disabled" disabled title="Only the creator can edit this record"><Pencil size={16} /> Creator protected</button>}
            <button className="button button--secondary" disabled={launching} onClick={() => void simulate()}><Sparkles size={16} /> {launching ? 'Packaging...' : 'Simulate'}</button>
            {asset.type === 'world' && <Link className="button button--secondary" to={`/asset/${asset.id}/saves`}><Archive size={16} /> Save Archive</Link>}
            {canEdit && <button className="button button--secondary" disabled={downloading} onClick={() => void download()}><Download size={16} /> {downloading ? 'Downloading...' : asset.type === 'world' ? 'Download world' : 'Download SPC'}</button>}
            {canEdit && asset.type === 'world' && <button className="button button--danger" disabled={deleting} onClick={() => void reviewDeleteWorld()}><Trash2 size={16} /> {deleting ? 'Checking...' : 'Delete World'}</button>}
          </div>
          {launchError && <p className="form-message" role="alert">{launchError} {launchError.includes('Account settings') && <Link to="/account">Open Account</Link>}</p>}
          {deleteError && <p className="form-message" role="alert">{deleteError}</p>}
          {downloadError && <p className="form-message" role="alert">{downloadError}</p>}
          {deleteImpact && asset.type === 'world' && <section className="world-delete-review" role="dialog" aria-modal="true" aria-labelledby="world-delete-title">
            <header>
              <div><span className="eyebrow">Permanent action</span><h2 id="world-delete-title">Delete {asset.name}</h2></div>
              <button type="button" className="button button--secondary" onClick={() => { setDeleteImpact(null); setDeleteConfirmation(''); }}>Cancel</button>
            </header>
            <p>This permanently removes the world{deleteImpact.totalChildren ? ` and ${deleteImpact.totalChildren} authored child record${deleteImpact.totalChildren === 1 ? '' : 's'}` : ''}. Deleted SPC catalogue designations are retired and external references may become invalid.</p>
            {deleteImpact.totalChildren > 0 && <div className="world-delete-review__impact">
              {Object.entries(deleteImpact.byType).filter(([, count]) => count > 0).map(([type, count]) => <span key={type}><strong>{count}</strong> {type}{count === 1 ? '' : 's'}</span>)}
            </div>}
            <div className="world-delete-review__backup">
              <strong>Back up first if you may need this world again.</strong>
              <button type="button" className="button button--secondary" disabled={downloading} onClick={() => void download()}><Download size={16} /> {downloading ? 'Downloading...' : 'Download world backup'}</button>
            </div>
            <label className="world-delete-review__confirm">
              <span>Type <strong>DELETE {asset.name}</strong> to confirm.</span>
              <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <button type="button" className="button button--danger" disabled={deleting || deleteConfirmation !== `DELETE ${asset.name}`} onClick={() => void deleteWorld()}><Trash2 size={16} /> {deleting ? 'Deleting permanently...' : 'Permanently delete world'}</button>
          </section>}
        </div>
      </section>
      <div className="detail-layout">
        <section className="record-panel">
          <div className="record-panel__heading">
            <span className="eyebrow">Archive record</span>
            <h2>Authored details</h2>
            <p>Canon, relationships and structured notes held by Orbis. Internal source keys stay protected.</p>
          </div>
          <DocumentContent document={asset.document} />
        </section>
        <aside className="metadata-panel">
          <h2>Record details</h2>
          {asset.speculus && <div><Sparkles /><span><small>Speculus registry</small><strong title={asset.speculus.classification}>{asset.speculus.code}</strong></span></div>}
          {asset.author && <div>{asset.author.avatarUrl ? <img className="author-avatar" src={asset.author.avatarUrl} alt="" /> : <UserRound />}<span><small>Created by</small><strong>{asset.author.displayName}</strong></span></div>}
          {asset.originWorldName && <div><MapPin /><span><small>Origin world</small><strong>{asset.originWorldName}</strong></span></div>}
          <div><Boxes /><span><small>Known dependencies</small><strong>{asset.dependencyCount} connected records</strong></span></div>
          <div><Clock3 /><span><small>Last tended</small><strong>{new Date(asset.updatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</strong></span></div>
        </aside>
      </div>
    </div>
  );
}

function isRecord(value: unknown): value is DocumentRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasValue(value: unknown) {
  return value !== '' && value != null && (!Array.isArray(value) || value.length > 0);
}

function isTechnicalKey(key: string) {
  return key === 'id' || key === 'sourceId' || /Ids?$/.test(key);
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function recordTitle(document: DocumentRecord) {
  if (typeof document.name === 'string' && document.name.trim()) return document.name.trim();
  if (typeof document.title === 'string' && document.title.trim()) return document.title.trim();
  if (isRecord(document.identity) && typeof document.identity.name === 'string' && document.identity.name.trim()) return document.identity.name.trim();
  return '';
}

function recordKind(document: DocumentRecord) {
  const value = typeof document.kind === 'string' ? document.kind : typeof document.type === 'string' ? document.type : '';
  return value ? humanize(value) : '';
}

function visibleEntries(document: DocumentRecord, insideCard = false) {
  return Object.entries(document).filter(([key, value]) => {
    if (!hasValue(value) || isTechnicalKey(key) || key === 'name' || key === 'title') return false;
    if (insideCard && (key === 'kind' || key === 'type')) return false;
    return true;
  });
}

function DocumentContent({ document, depth = 0, insideCard = false }: { document?: DocumentRecord; depth?: number; insideCard?: boolean }) {
  if (!document) return null;
  const entries = visibleEntries(document, insideCard);
  if (!entries.length) return null;
  return <div className={`document-content ${depth === 0 ? 'document-content--root' : 'document-content--nested'}`}>{entries.map(([key, value]) => <DocumentValue key={key} label={key} value={value} depth={depth} />)}</div>;
}

function DocumentValue({ label, value, depth }: { label: string; value: unknown; depth: number }) {
  const heading = humanize(label);
  const topLevel = depth === 0;

  if (Array.isArray(value)) {
    const objects = value.filter(isRecord);
    if (objects.length === value.length && objects.length > 0) {
      const body = <div className="document-record-grid">{objects.map((item, index) => <DocumentRecordCard document={item} key={`${recordTitle(item) || recordKind(item) || label}-${index}`} depth={depth + 1} />)}</div>;
      if (topLevel) return <section className="document-section"><SectionHeader title={heading} count={objects.length} />{body}</section>;
      return <div className="document-field document-field--collection"><FieldHeader title={heading} count={objects.length} />{body}</div>;
    }

    const body = <ul className="document-list">{value.map((item, index) => <li key={index}>{displayScalar(item)}</li>)}</ul>;
    if (topLevel) return <section className="document-section"><SectionHeader title={heading} />{body}</section>;
    return <div className="document-field document-field--wide"><h4>{heading}</h4>{body}</div>;
  }

  if (isRecord(value)) {
    const body = <DocumentContent document={value} depth={depth + 1} />;
    if (topLevel) return <section className="document-section"><SectionHeader title={heading} />{body}</section>;
    return <div className="document-field document-field--group"><h4>{heading}</h4>{body}</div>;
  }

  const scalar = displayScalar(value);
  const wide = typeof scalar === 'string' && scalar.length > 90;
  if (topLevel) return <section className="document-section"><SectionHeader title={heading} /><p className="document-section__prose">{scalar}</p></section>;
  return <div className={`document-field${wide ? ' document-field--wide' : ''}`}><h4>{heading}</h4><p>{scalar}</p></div>;
}

function DocumentRecordCard({ document, depth }: { document: DocumentRecord; depth: number }) {
  const title = recordTitle(document);
  const kind = recordKind(document);
  const content = <DocumentContent document={document} depth={depth} insideCard />;
  return (
    <article className="document-record-card">
      {(title || kind) && <header className="document-record-card__header">{kind && <span>{kind}</span>}{title && <strong>{title}</strong>}</header>}
      {content}
    </article>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return <header className="document-section__header"><h3>{title}</h3>{count !== undefined && <span>{count} {count === 1 ? 'record' : 'records'}</span>}</header>;
}

function FieldHeader({ title, count }: { title: string; count: number }) {
  return <div className="document-field__header"><h4>{title}</h4><span>{count}</span></div>;
}

function displayScalar(value: unknown) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && /^[a-z0-9-]+(?:_[a-z0-9-]+)+$/i.test(value)) return humanize(value);
  return String(value);
}
