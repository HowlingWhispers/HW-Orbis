import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { libraryApi } from '../src/api/client';
import { HttpLibraryApi } from '../src/api/http-client';
import { consumeSimulationLaunchSetup, stageSimulationLaunchSetup } from '../src/api/simulation-launch-setup';
import { PersonaPicker } from '../src/components/PersonaPicker';

afterEach(() => {
  cleanup();
  consumeSimulationLaunchSetup();
  vi.restoreAllMocks();
});

describe('Persona picker', () => {
  it('requires both an explicit Persona and starting Place before launch', async () => {
    vi.spyOn(libraryApi, 'listSimulationPersonas').mockResolvedValue([
      { id: 'owned', name: 'Eirvargr', summary: 'A wandering wolf.', owned: true, age: 25, adultToneEligible: true },
      { id: 'shared', name: 'Mara', summary: 'Shared for use.', owned: false, adultToneEligible: false },
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

    const personaSelect = await screen.findByRole('combobox', { name: 'Player Persona' });
    const placeSelect = screen.getByRole('combobox', { name: 'Starting Place' });
    fireEvent.change(personaSelect, { target: { value: 'shared' } });
    expect(start).toBeDisabled();
    fireEvent.change(placeSelect, { target: { value: 'hollowmere' } });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(select).toHaveBeenCalledWith('shared', 'hollowmere');
  });

  it('preselects a directly opened Place while still showing the dropdown choice', async () => {
    vi.spyOn(libraryApi, 'listSimulationPersonas').mockResolvedValue([
      { id: 'owned', name: 'Eirvargr', summary: '', owned: true, age: 25, adultToneEligible: true },
    ]);
    vi.spyOn(libraryApi, 'listSimulationPlaces').mockResolvedValue([
      { id: 'hollowmere', name: 'Hollowmere', summary: '', isTarget: true },
      { id: 'brackenjaw', name: 'Brackenjaw Enclave', summary: '', isTarget: false },
    ]);
    render(<PersonaPicker targetId="hollowmere" targetName="Hollowmere" initialPlaceId="hollowmere" busy={false} onCancel={vi.fn()} onSelect={vi.fn()} />);

    const placeSelect = await screen.findByRole('combobox', { name: 'Starting Place' });
    expect(placeSelect).toHaveValue('hollowmere');
    expect(screen.getByRole('option', { name: /Hollowmere.*This Place/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start simulation' })).toBeEnabled();
  });

  it('keeps Adult / erotic unavailable for a Persona that is not explicitly adult-eligible', async () => {
    vi.spyOn(libraryApi, 'listSimulationPersonas').mockResolvedValue([
      { id: 'luna', name: 'Luna', summary: 'Young wolf girl.', owned: true, age: 12, adultToneEligible: false },
    ]);
    vi.spyOn(libraryApi, 'listSimulationPlaces').mockResolvedValue([
      { id: 'station', name: 'Ranger Station', summary: '', isTarget: true },
    ]);
    render(<PersonaPicker targetId="world" targetName="Bitterroot" busy={false} onCancel={vi.fn()} onSelect={vi.fn()} />);

    await screen.findByRole('combobox', { name: 'Player Persona' });
    expect(screen.getByRole('option', { name: /Adult \/ erotic.*unavailable/ })).toBeDisabled();
  });

  it('lets a world with zero Places launch without a location anchor', async () => {
    vi.spyOn(libraryApi, 'listSimulationPersonas').mockResolvedValue([
      { id: 'owned', name: 'Eirvargr', summary: 'A wandering wolf.', owned: true, age: 25, adultToneEligible: true },
      { id: 'shared', name: 'Mara', summary: 'Shared for use.', owned: false, adultToneEligible: false },
    ]);
    vi.spyOn(libraryApi, 'listSimulationPlaces').mockResolvedValue([]);
    const select = vi.fn();
    render(<PersonaPicker targetId="world" targetName="Bitterroot" busy={false} onCancel={vi.fn()} onSelect={select} />);

    expect(await screen.findByText('No starting Place is defined for this world. The simulation will begin without a location anchor.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Starting Place' })).not.toBeInTheDocument();

    const start = screen.getByRole('button', { name: 'Start simulation' });
    expect(start).toBeDisabled();

    fireEvent.change(await screen.findByRole('combobox', { name: 'Player Persona' }), { target: { value: 'owned' } });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(select).toHaveBeenCalledWith('owned', undefined);
  });

  it('does not carry a Place forward when a target has none to choose from', async () => {
    vi.spyOn(libraryApi, 'listSimulationPersonas').mockResolvedValue([
      { id: 'owned', name: 'Eirvargr', summary: '', owned: true, adultToneEligible: true },
    ]);
    const places = vi.spyOn(libraryApi, 'listSimulationPlaces')
      .mockResolvedValueOnce([{ id: 'hollowmere', name: 'Hollowmere', summary: '', isTarget: true }])
      .mockResolvedValueOnce([]);
    const select = vi.fn();
    const { rerender } = render(<PersonaPicker targetId="world" targetName="Bitterroot" initialPlaceId="hollowmere" busy={false} onCancel={vi.fn()} onSelect={select} />);
    expect((await screen.findByRole('combobox', { name: 'Starting Place' }))).toHaveValue('hollowmere');

    rerender(<PersonaPicker targetId="other-world" targetName="Untitled World" initialPlaceId="hollowmere" busy={false} onCancel={vi.fn()} onSelect={select} />);
    await screen.findByText('No starting Place is defined for this world. The simulation will begin without a location anchor.');

    fireEvent.click(screen.getByRole('button', { name: 'Start simulation' }));
    expect(places).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenCalledWith('owned', undefined);
  });

  it('stages tone, tags and direction as launch-only setup', async () => {
    vi.spyOn(libraryApi, 'listSimulationPersonas').mockResolvedValue([
      { id: 'adult', name: 'Eirvargr', summary: '', owned: true, age: 25, adultToneEligible: true },
    ]);
    vi.spyOn(libraryApi, 'listSimulationPlaces').mockResolvedValue([
      { id: 'hollowmere', name: 'Hollowmere', summary: '', isTarget: true },
    ]);
    render(<PersonaPicker targetId="world" targetName="Bitterroot" busy={false} onCancel={vi.fn()} onSelect={vi.fn()} />);

    const toneSelect = await screen.findByRole('combobox', { name: 'Content / tone' });
    fireEvent.change(toneSelect, { target: { value: 'mature' } });
    fireEvent.change(screen.getByPlaceholderText(/family, slice-of-life/), { target: { value: ' storm, slow-burn, storm ' } });
    fireEvent.change(screen.getByPlaceholderText(/Describe what this session should focus on/), { target: { value: ' Keep the journey tense and character-focused. ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start simulation' }));

    expect(consumeSimulationLaunchSetup()).toEqual({
      tone: 'mature',
      focusTags: ['storm', 'slow-burn'],
      direction: 'Keep the journey tense and character-focused.',
    });
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

  it('posts staged launch steering together with the simulation request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ launchUrl: 'https://spec.example/launch', expiresAt: 123 }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    }));
    stageSimulationLaunchSetup({ tone: 'mature', focusTags: ['storm'], direction: 'Slow pace.' });
    const api = new HttpLibraryApi('/api');

    await api.simulateAsset('target/id', 'persona-id', 'place-id');

    expect(fetcher).toHaveBeenCalledWith('/api/v1/library/assets/target%2Fid/simulate', expect.objectContaining({
      method: 'POST',
      body: '{"personaId":"persona-id","startingPlaceId":"place-id","tone":"mature","focusTags":["storm"],"direction":"Slow pace."}',
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
