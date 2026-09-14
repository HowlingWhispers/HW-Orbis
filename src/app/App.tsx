import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { AccountView } from '../views/AccountView';
import { AdminView } from '../views/AdminView';
import { AssetDetailView } from '../views/AssetDetailView';
import { AssetEditorView } from '../views/AssetEditorView';
import { CollectionView } from '../views/CollectionView';
import { HomeView } from '../views/HomeView';
import { NotFoundView } from '../views/NotFoundView';
import { ProjectView } from '../views/ProjectView';
import { SaveArchiveView } from '../views/SaveArchiveView';
import { VerificationView } from '../views/VerificationView';

export function App() {
  return <AppShell><Routes>
    <Route path="/" element={<HomeView />} />
    <Route path="/library" element={<Navigate to="/library/worlds" replace />} />
    <Route path="/library/:collection" element={<CollectionView />} />
    <Route path="/asset/:id" element={<AssetDetailView />} />
    <Route path="/asset/:id/saves" element={<SaveArchiveView />} />
    <Route path="/asset/:id/edit" element={<AssetEditorView />} />
    <Route path="/project/:slug" element={<ProjectView />} />
    <Route path="/account" element={<AccountView />} />
    <Route path="/admin" element={<AdminView />} />
    <Route path="/verification" element={<VerificationView />} />
    <Route path="*" element={<NotFoundView />} />
  </Routes></AppShell>;
}
