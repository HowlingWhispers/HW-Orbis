import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { libraryApi } from '../src/api/client';
import { HttpLibraryApi } from '../src/api/http-client';
import { PersonaPicker } from '../src/components/PersonaPicker';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Persona picker', () => {
  it('opens as an accessible dialog and launches only after an explicit selection', async () => {
    vi.spyOn(libraryApi, 'listSimulationPersonas').mockResolvedValue([
      { id: 'owned', name: 'Eirvargr', summary: 'A wandering wolf.', owned: true },
      { id: 'shared', name: 'Mara', summary: 'Shared for use.', owned: false },
    ]);
    const select = vi.fn();
    render(<PersonaPicker targetName="Bitterroot" busy={false} onCancel={vi.fn()} onSelect={select} />);

    expect(screen.getByRole('dialog', { name: 'Simulate Bitterroot' })).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start simulation' });
    expect(start).toBeDisabled();
    fireEvent.click(await screen.findByRole('radio', { name: /Mara.*Shared/ }));
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(select).toHaveBeenCalledWith('shared');
  });

  it('reports when no Persona is available instead of launching an empty choice', async () => {
    vi.spyOn(libraryApi, 'listSimulationPersonas').mockResolvedValue([]);
    render(<PersonaPicker targetName="Hollowmere" busy={false} onCancel={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByText(/No Personas are available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start simulation' })).toBeDisabled();
  });

  it('posts the selected personaId in the launch request body', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ launchUrl: 'https://spec.example/launch', expiresAt: 123 }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    }));
    const api = new HttpLibraryApi('/api');

    await api.simulateAsset('target/id', 'persona-id');

    expect(fetcher).toHaveBeenCalledWith('/api/v1/library/assets/target%2Fid/simulate', expect.objectContaining({
      method: 'POST', body: '{"personaId":"persona-id"}',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }));
  });
});
