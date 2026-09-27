import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authState: { user: unknown; loading: boolean } = { user: null, loading: false };

vi.mock('../src/auth/AuthContext', () => ({
  useAuth: () => authState,
  discordLoginPath: (returnTo: string) => `/api/auth/discord?returnTo=${returnTo}`,
}));

import { AdminView } from '../src/views/AdminView';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const adminUser = { id: '00000000-0000-4000-8000-000000000001', displayName: 'Keeper', permissions: { canAdmin: true } };

const settings = {
  guildId: '1544909655275208716', adultRoleIds: [], creatorRoleIds: [], adminRoleIds: ['222222222222222222'],
  inviteUrl: '', effectiveCreatorRoleIds: [], creatorUsesAdultFallback: false, bootstrapAdminRoleIds: [],
  sources: { guildId: 'environment', adultRoleIds: 'environment', creatorRoleIds: 'environment', adminRoleIds: 'environment', inviteUrl: 'default' },
};

function jsonResponse(body: unknown) {
  return {
    ok: true, status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
    json: async () => body,
  } as unknown as Response;
}

/**
 * What a server that does not have a route actually sends back: the single-page
 * app, with a 200 and a text/html content type. `json()` rejects the way it does
 * in a real browser so the test proves the guard fires before the parse.
 */
function spaResponse() {
  return {
    ok: true, status: 200,
    headers: { get: () => 'text/html; charset=utf-8' },
    json: async () => { throw new SyntaxError("Unexpected token '<'"); },
  } as unknown as Response;
}

function stubFetch(handler: (path: string) => Response) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => handler(String(input))));
}

function adminViewPreferencesResponse() {
  return jsonResponse({ preferences: { hidePrivateUserWorlds: true } });
}

describe('admin control room load resilience', () => {
  it('opens the control room when every endpoint answers', async () => {
    authState.user = adminUser;
    stubFetch((path) => {
      if (path.endsWith('/overview')) return jsonResponse({ status: {}, secrets: {}, system: { version: 'test', buildSha: 'test', environment: 'test' } });
      if (path.endsWith('/settings')) return jsonResponse({ settings, roleResolution: { available: true, reason: 'ok' } });
      if (path.endsWith('/audit')) return jsonResponse({ items: [] });
      return adminViewPreferencesResponse();
    });

    render(<AdminView />);

    await waitFor(() => expect(screen.queryByText('Control room unavailable')).toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps the console usable when one endpoint is missing from the server', async () => {
    authState.user = adminUser;
    stubFetch((path) => {
      if (path.endsWith('/overview')) return jsonResponse({ status: {}, secrets: {}, system: { version: 'test', buildSha: 'test', environment: 'test' } });
      if (path.endsWith('/settings')) return jsonResponse({ settings, roleResolution: { available: true, reason: 'ok' } });
      if (path.endsWith('/audit')) return jsonResponse({ items: [] });
      return spaResponse();
    });

    render(<AdminView />);

    // A dead preference toggle must not take down the sections that answered.
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.queryByText('Control room unavailable')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/still usable/i);
  });

  it('never leaks a raw JSON parse error from an HTML response', async () => {
    authState.user = adminUser;
    stubFetch(() => spaResponse());

    render(<AdminView />);

    await waitFor(() => expect(screen.getByText('Control room unavailable')).toBeTruthy());
    const body = screen.getByText('Control room unavailable').parentElement?.textContent ?? '';
    expect(body).not.toMatch(/Unexpected token/);
    expect(body).not.toMatch(/is not a function|SyntaxError/);
  });

  it('reports a network failure in plain language', async () => {
    authState.user = adminUser;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    render(<AdminView />);

    await waitFor(() => expect(screen.getByText('Control room unavailable')).toBeTruthy());
    const body = screen.getByText('Control room unavailable').parentElement?.textContent ?? '';
    expect(body).toMatch(/could not reach the administration service/i);
  });
});
