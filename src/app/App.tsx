import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { AssetDetailView } from '../views/AssetDetailView';
import { CollectionView } from '../views/CollectionView';
import { HomeView } from '../views/HomeView';
import { NotFoundView } from '../views/NotFoundView';
import { AccountView } from '../views/AccountView';
import { VerificationView } from '../views/VerificationView';
import { AdminView } from '../views/AdminView';
import { AssetEditorView } from '../views/AssetEditorView';
import { ProjectView } from '../views/ProjectView';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomeView />} />
        <Route path="all" element={<CollectionView all />} />
        <Route path="library/:type" element={<CollectionView />} />
        <Route path="asset/:id" element={<AssetDetailView />} />
        <Route path="asset/:id/edit" element={<AssetEditorView />} />
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
