import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../components/AppShell';
import { AccountView } from '../views/AccountView';
import { AdminView } from '../views/AdminView';
import { AssetDetailView } from '../views/AssetDetailView';
import { AssetEditorView } from '../views/AssetEditorView';
import { CodaWorkspaceView } from '../views/CodaWorkspaceView';
import { ChangelogView } from '../views/ChangelogView';
import { CollectionView } from '../views/CollectionView';
import { CreatePersonaView } from '../views/CreatePersonaView';
import { CreateWorldView } from '../views/CreateWorldView';
import { HomeView } from '../views/HomeView';
import { NotFoundView } from '../views/NotFoundView';
import { ProjectView } from '../views/ProjectView';
import { SaveArchiveView } from '../views/SaveArchiveView';
import { VerificationView } from '../views/VerificationView';

/**
 * Mirrors the server's requireCreator gate. A hidden button is not a control:
 * the route has to explain itself instead of rendering a form that would 403.
 */
function RequireCreator({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.permissions.canCreate) return <>{children}</>;
  return (
    <div className="page">
      <header className="collection-header__copy">
        <span className="eyebrow">Worldbuilding</span>
        <h1>Worldbuilding is role-gated</h1>
        <p>
          Creating records in Orbis is currently limited to members holding the
          Worldbuilding role in Howling Whispers. Ask an admin for the role if you
          want to build here.
        </p>
      </header>
      <p className="collection-description">
        Browsing, reading and running existing worlds is unaffected.
      </p>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomeView />} />
        <Route path="all" element={<CollectionView all />} />
        <Route path="library/:type" element={<CollectionView />} />
        <Route path="worlds/new" element={<RequireCreator><CreateWorldView /></RequireCreator>} />
        <Route path="personas/new" element={<RequireCreator><CreatePersonaView /></RequireCreator>} />
        <Route path="asset/:id" element={<AssetDetailView />} />
        <Route path="asset/:id/saves" element={<SaveArchiveView />} />
        <Route path="asset/:id/edit" element={<AssetEditorView />} />
        <Route path="coda" element={<CodaWorkspaceView />} />
        <Route path="changelog" element={<ChangelogView />} />
        <Route path="projects/:slug" element={<ProjectView />} />
        <Route path="account" element={<AccountView />} />
        <Route path="verification" element={<VerificationView />} />
        <Route path="admin" element={<AdminView />} />
        <Route path="admin/big-brother" element={<Navigate to="/admin?tab=bigbrother" replace />} />
        <Route path="library" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundView />} />
      </Route>
    </Routes>
  );
}
