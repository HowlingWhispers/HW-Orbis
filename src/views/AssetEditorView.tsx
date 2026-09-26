import { ArrowLeft, CircleAlert } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { libraryApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CodaFileAssistant } from '../components/CodaFileAssistant';
import { GenericAssetEditor } from '../components/GenericAssetEditor';
import { ErrorState, LoadingState } from '../components/StatePanel';
import { WorldForgeEditor } from '../components/WorldForgeEditor';
import { useLibraryData } from '../hooks/useLibraryData';

export function AssetEditorView() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const codaMode = searchParams.get('coda') === '1';
  const { user, loading: authLoading } = useAuth();
  const { data: asset, error, loading, retry } = useLibraryData((signal) => libraryApi.getAsset(id, signal), [id]);

  useEffect(() => {
    if (!codaMode) return;
    document.body.classList.add('coda-file-mode');
    return () => document.body.classList.remove('coda-file-mode');
  }, [codaMode]);

  if (loading || authLoading) return <div className="page"><LoadingState label="Preparing the editor..." /></div>;
  if (error || !asset) return <div className="page"><ErrorState retry={retry} /></div>;
  if (!user) return <div className="page editor-denied"><CircleAlert /><h1>Sign in to edit</h1><p>Discord ownership protects every Orbis record.</p></div>;
  if (!asset.canEdit) return <div className="page editor-denied"><CircleAlert /><h1>Record protected</h1><p>Only {asset.author?.displayName ?? 'the original creator'} can change this record.</p><Link className="button button--secondary" to={`/asset/${asset.id}`}>Return to record</Link></div>;

  const editor = asset.type === 'world' ? <WorldForgeEditor asset={asset} /> : <GenericAssetEditor asset={asset} />;

  return <div className={`page editor-page ${codaMode ? 'editor-page--coda' : ''}`}>
    <Link className="back-link" to={`/asset/${asset.id}`}><ArrowLeft size={16} /> Back to record</Link>
    {codaMode
      ? <div className="coda-file-layout"><CodaFileAssistant asset={asset} /><div className="coda-file-layout__editor">{editor}</div></div>
      : editor}
  </div>;
}
