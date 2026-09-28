import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountView } from '../src/views/AccountView';

const user = {
  displayName: 'Eirvargr', discordUsername: 'eirvargr', discordId: '1',
  permissions: { canCreate: true },
};

vi.mock('../src/auth/AuthContext', () => ({
  discordLoginPath: () => '/auth/discord',
  useAuth: () => ({ user, loading: false, updateDisplayName: vi.fn(), logout: vi.fn() }),
}));
vi.mock('../src/hooks/useSEO', () => ({ useSEO: () => undefined }));
vi.mock('../src/i18n/I18nContext', () => ({
  useI18n: () => ({ locale: 'en', setLocale: vi.fn(), t: (key: string) => key }),
}));
vi.mock('../src/theme/ThemeContext', () => ({
  useTheme: () => ({ preference: 'dark', setPreference: vi.fn(), themeOptions: [] }),
}));

const json = (body: unknown) => new Response(JSON.stringify(body));

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/shared-use/allowed')) return json({ allowed: [], available: true });
    return json({ configured: true, model: 'xialong-v1', sharedUse: false, sharedUseAvailable: true });
  });
  window.history.replaceState(null, '', '/account');
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('account page sections', () => {
  it('shows one panel at a time and marks the active tab', async () => {
    render(<AccountView />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs).toHaveLength(4);

    // Role queries already exclude hidden panels, so exactly one is reachable.
    // Only the selected tab is a single stop in the tab sequence.
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(4);
    expect(screen.getByLabelText('Orbis display name')).toBeVisible();
    expect(screen.queryByLabelText('Interface language')).not.toBeVisible();
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');

    fireEvent.click(screen.getByRole('tab', { name: /Preferences/ }));
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByLabelText('Interface language')).toBeVisible();
    expect(screen.getByRole('tab', { name: /Preferences/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves between tabs with the arrow keys and wraps at both ends', async () => {
    render(<AccountView />);
    const first = await screen.findByRole('tab', { name: /Profile/ });

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Coda sharing/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(screen.getByRole('tab', { name: /Coda sharing/ }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: /Profile/ })).toHaveAttribute('aria-selected', 'true');

    // Wraps backwards from the first tab to the last.
    fireEvent.keyDown(screen.getByRole('tab', { name: /Profile/ }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: /Your data/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(screen.getByRole('tab', { name: /Your data/ }), { key: 'End' });
    expect(screen.getByRole('tab', { name: /Your data/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps a half-entered token when the reader visits another tab', async () => {
    render(<AccountView />);
    const token = await screen.findByLabelText('NovelAI for Speculus & Coda');
    fireEvent.change(token, { target: { value: 'a-token-the-user-is-midway-through-pasting' } });

    fireEvent.click(screen.getByRole('tab', { name: /Your data/ }));
    expect(screen.getByRole('button', { name: /Download everything/ })).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: /Profile/ }));
    // Panels are hidden, never unmounted, so the paste survives the round trip.
    expect(screen.getByLabelText('NovelAI for Speculus & Coda')).toHaveValue('a-token-the-user-is-midway-through-pasting');
  });

  it('records the open section in the URL so it can be linked to', async () => {
    render(<AccountView />);
    await screen.findAllByRole('tab');
    fireEvent.click(screen.getByRole('tab', { name: /Coda sharing/ }));
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('sharing');
  });

  it('honours ?tab= on load and ignores an unknown value', async () => {
    window.history.replaceState(null, '', '/account?tab=data');
    const { unmount } = render(<AccountView />);
    expect(await screen.findByRole('button', { name: /Download everything/ })).toBeVisible();
    unmount();

    window.history.replaceState(null, '', '/account?tab=nonsense');
    render(<AccountView />);
    expect(await screen.findByLabelText('Orbis display name')).toBeVisible();
  });
});
