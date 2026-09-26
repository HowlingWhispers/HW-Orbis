import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { AccountView } from '../views/AccountView';
import { AdminView } from '../views/AdminView';
import { AssetDetailView } from '../views/AssetDetailView';
import { AssetEditorView } from '../views/AssetEditorView';
import { CodaWorkspaceView } from '../views/CodaWorkspaceView';
import { CollectionView } from '../views/CollectionView';
import { HomeView } from '../views/HomeView';
import { NotFoundView } from '../views/NotFoundView';
import { ProjectView } from '../views/ProjectView';
import { SaveArchiveView } from '../views/SaveArchiveView';
import { VerificationView } from '../views/VerificationView';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomeView />} />
        <Route path="all" element={<CollectionView all />} />
        <Route path="library/:type" element={<CollectionView />} />
        <Route path="asset/:id" element={<AssetDetailView />} />
        <Route path="asset/:id/saves" element={<SaveArchiveView />} />
        <Route path="asset/:id/edit" element={<AssetEditorView />} />
        <Route path="coda" element={<CodaWorkspaceView />} />
        <Route path="projects/:slug" element={<ProjectView />} />
        <Route path="account" element={<AccountView />} />
        <Route path="verification" element={<VerificationView />} />
        <Route path="admin" element={<AdminView />} />
        <Route path="library" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundView />} />
      </Route>
    </Routes>
  );
}
