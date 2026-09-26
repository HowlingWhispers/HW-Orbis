import { afterEach, describe, expect, it, vi } from 'vitest';
import { askCoda } from '../src/api/coda-assistant';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Coda assistant client', () => {
  it('never authorizes model-generated operations during generation', async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ mode: 'sort', summary: 'Draft only.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'x-request-id': 'test-request' },
      });
    }));

    await askCoda({
      mode: 'sort',
      text: 'Create something',
      applyOperations: true,
    });

    expect(requestBody?.applyOperations).toBe(false);
  });
});
