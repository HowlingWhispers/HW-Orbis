import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNovelAiSettings, setNovelAiSharedUse } from '../src/api/provider-settings';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shared-use consent client', () => {
  it('sends consent to the dedicated endpoint and reports the stored result', async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body ? String(init.body) : undefined });
      return new Response(JSON.stringify({ sharedUse: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const result = await setNovelAiSharedUse(true);

    expect(result).toEqual({ sharedUse: true });
    expect(calls[0].url).toBe('/api/provider-settings/novelai/shared-use');
    expect(calls[0].method).toBe('PUT');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ enabled: true });
  });

  it('treats the server response as authoritative rather than the optimistic tick', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sharedUse: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    // The account view flips the tick immediately, so a refusal must be able to
    // pull it back. The server value wins.
    await expect(setNovelAiSharedUse(true)).resolves.toEqual({ sharedUse: false });
  });

  it('surfaces the server message when consent cannot be stored', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Connect a NovelAI key in Orbis before letting it help power Discord Coda.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )));
    await expect(setNovelAiSharedUse(true)).rejects.toThrow(/Connect a NovelAI key/);
  });

  it('never puts key material on the wire when reading settings', async () => {
    let url = '';
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      url = String(input);
      return new Response(JSON.stringify({
        configured: true, model: 'xialong-v1', sharedUse: false, sharedUseAvailable: true,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const settings = await getNovelAiSettings();

    expect(url).toBe('/api/provider-settings/novelai');
    expect(settings.configured).toBe(true);
    expect(settings.sharedUse).toBe(false);
    expect(settings.sharedUseAvailable).toBe(true);
    // The read is a plain GET with no body, so no token can be echoed anywhere.
    expect(settings).not.toHaveProperty('token');
  });
});
