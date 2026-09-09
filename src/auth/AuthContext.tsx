import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface OrbisUser {
  id: string;
  displayName: string;
  discordUsername: string;
  avatarUrl?: string;
  avatarDecorationUrl?: string;
  accentColor?: number;
  displayNameCustomized: boolean;
  isSuperAdmin: boolean;
  permissions: {
    isGuildMember: boolean;
    canViewAdult: boolean;
    canCreate: boolean;
    canAdmin: boolean;
  };
}

interface AuthContextValue {
  user: OrbisUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Coda could not complete that request.');
  return data;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<OrbisUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Auth unavailable');
      const data = await response.json() as { user: OrbisUser | null };
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const updateDisplayName = useCallback(async (displayName: string) => {
    const response = await fetch('/api/auth/profile', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    const data = await readJson<{ user: OrbisUser }>(response);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    if (!response.ok) throw new Error('Sign out failed.');
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, refresh, updateDisplayName, logout }), [user, loading, refresh, updateDisplayName, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}

export const discordLoginPath = (returnTo = '/') => `/api/auth/discord/login?returnTo=${encodeURIComponent(returnTo)}`;
