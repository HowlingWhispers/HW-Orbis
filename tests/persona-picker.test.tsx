import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { libraryApi } from '../src/api/client';
import { HttpLibraryApi } from '../src/api/http-client';
import { PersonaPicker } from '../src/components/PersonaPicker';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Persona picker', () => {
  it('requires both an explicit Persona and starting Place before launch', async () => {
    vi.spyOn(libraryApi, 'listSimulationPersonas').mockResolvedValue([
      { id: 'owned', name: 'Eirvargr', summary: 'A wandering wolf.', owned: true },
      { id: 'shared', name: 'Mara', summary: 'Shared for use.', owned: false },
    ]);
    vi.spyOn(libraryApi, 'listSimulationPlaces').mockResolvedValue([
      { id: 'hollowmere', name: 'Hollowmere', summary: 'Market town.', kind: 'settlement', isTarget: false },
      { id: 'brackenjaw', name: 'Brackenjaw Enclave', summary: 'Upland settlement.', kind: 'settlement', isTarget: false },
    ]);
    const select = vi.fn();
    render(<PersonaPicker targetId="world" targetName="Bitterroot" busy={false} onCancel={vi.fn()} onSelect={select} />);

    expect(screen.getByRole('dialog', { name: 'Simulate Bitterroot' })).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start simulation' });
    expect(start).toBeDisabled();
    fireEvent.click(await screen.findByRole('radio', { name: /Mara.*Shared/ }));
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Hollowmere.*Market town/ }));
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(select).toHaveBeenCalledWith('shared', 'hollowmere');
  });

  it('preselects a directly opened Place while still showing the choice', async () => {
    vi.spyOn(libraryApi, 'listSimulationPersonas').mockResolvedValue([
      { id: 'owned', name: 'Eirvargr', summary: '', owned: true },
    ]);
    vi.spyOn(libraryApi, 'listSimulationPlaces').mockResolvedValue([
      { id: 'hollowmere', name: 'Hollowmere', summary: '', isTarget: true },
      { id: 'brackenjaw', name: 'Brackenjaw Enclave', summary: '', isTarget: false },
    ]);
    render(<PersonaPicker targetId="hollowmere" targetName="Hollowmere" initialPlaceId="hollowmere" busy={false} onCancel={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByRole('radio', { name: /Hollowmere.*This Place/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Start simulation' })).toBeEnabled();
  });

  it('reports when no Persona is available instead of launching an empty choice', async () => {
    vi.spyOn(libraryApi, 'listSimulationPersonas').mockResolvedValue([]);
    vi.spyOn(libraryApi, 'listSimulationPlaces').mockResolvedValue([
      { id: 'hollowmere', name: 'Hollowmere', summary: '', isTarget: true },
    ]);
    render(<PersonaPicker targetId="hollowmere" targetName="Hollowmere" busy={false} onCancel={vi.fn()} onSelect={vi.fn()} />);

    expect(await screen.findByText(/No Personas are available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start simulation' })).toBeDisabled();
  });

  it('posts the starting Place when the launch has one', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ launchUrl: 'https://spec.example/launch', expiresAt: 123 }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    }));
    const api = new HttpLibraryApi('/api');

    await api.simulateAsset('target/id', 'persona-id', 'place-id');

    expect(fetcher).toHaveBeenCalledWith('/api/v1/library/assets/target%2Fid/simulate', expect.objectContaining({
      method: 'POST', body: '{"personaId":"persona-id","startingPlaceId":"place-id"}',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }));
  });

  it('keeps legacy launch requests compatible when no Place is supplied', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ launchUrl: 'https://spec.example/launch', expiresAt: 123 }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    }));
    const api = new HttpLibraryApi('/api');

    await api.simulateAsset('target/id', 'persona-id');

    expect(fetcher).toHaveBeenCalledWith('/api/v1/library/assets/target%2Fid/simulate', expect.objectContaining({
      method: 'POST', body: '{"personaId":"persona-id"}',
    }));
  });
});
