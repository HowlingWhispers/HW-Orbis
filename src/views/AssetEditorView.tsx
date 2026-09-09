import { ArrowLeft, CircleAlert } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { libraryApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { GenericAssetEditor } from '../components/GenericAssetEditor';
import { ErrorState, LoadingState } from '../components/StatePanel';
import { WorldForgeEditor } from '../components/WorldForgeEditor';
import { useLibraryData } from '../hooks/useLibraryData';

export function AssetEditorView() {
  const { id = '' } = useParams();
  const { user, loading: authLoading } = useAuth();
  const { data: asset, error, loading, retry } = useLibraryData((signal) => libraryApi.getAsset(id, signal), [id]);

  if (loading || authLoading) return <div className="page"><LoadingState label="Preparing the editor..." /></div>;
  if (error || !asset) return <div className="page"><ErrorState retry={retry} /></div>;
  if (!user) return <div className="page editor-denied"><CircleAlert /><h1>Sign in to edit</h1><p>Discord ownership protects every Coda record.</p></div>;
  if (!asset.canEdit) return <div className="page editor-denied"><CircleAlert /><h1>Record protected</h1><p>Only {asset.author?.displayName ?? 'the original creator'} can change this record.</p><Link className="button button--secondary" to={`/asset/${asset.id}`}>Return to record</Link></div>;

  return <div className="page editor-page">
    <Link className="back-link" to={`/asset/${asset.id}`}><ArrowLeft size={16} /> Back to record</Link>
    {asset.type === 'world' ? <WorldForgeEditor asset={asset} /> : <GenericAssetEditor asset={asset} />}
  </div>;
}
