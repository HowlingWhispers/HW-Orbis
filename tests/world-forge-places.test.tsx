import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { libraryApi } from '../src/api/client';
import { WorldForgeEditor } from '../src/components/WorldForgeEditor';
import type { LibraryAsset } from '../src/types/library';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const world: LibraryAsset = {
  id: 'world-1',
  type: 'world',
  name: 'Hollowmere',
  summary: 'A quiet town.',
  document: {
    identity: { name: 'Hollowmere' },
    lore: { history: 'Old history.' },
    locations: [{ id: 'stale-embedded', name: 'Stale embedded copy' }],
    species: [{ id: 'wolves', name: 'Wolves' }],
  },
  tags: [],
  contentRating: 'sfw',
  visualTone: 'mist',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  dependencyCount: 1,
  creatorUserId: 'owner',
  pinned: false,
  sourceType: 'user-created',
} as unknown as LibraryAsset;

function canonicalLocations() {
  return {
    locations: [
      { id: 'harbor', libraryAssetId: 'asset-harbor', name: 'Harbor', kind: 'city', description: 'By the sea' },
    ],
    species: [],
    factions: [],
    societies: [],
    families: [],
    memories: [],
  } as never;
}

function mockChildren() {
  vi.spyOn(libraryApi, 'listWorldChildren').mockResolvedValue(canonicalLocations());
}

async function openPlacesTab() {
  render(
    <MemoryRouter>
      <WorldForgeEditor asset={world} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Places' }));
  return screen.findByTitle('Edit');
}

describe('World Forge Places uses canonical child records', () => {
  it('reads canonical places and never shows the embedded array as canon', async () => {
    mockChildren();
    await openPlacesTab();

    expect(libraryApi.listWorldChildren).toHaveBeenCalledWith('world-1');
    expect(screen.getAllByText('Harbor').length).toBeGreaterThan(0);
    expect(screen.queryByText('Stale embedded copy')).not.toBeInTheDocument();
  });

  it('creates exactly one canonical child on add', async () => {
    mockChildren();
    const create = vi.spyOn(libraryApi, 'createWorldChild').mockResolvedValue({} as never);
    await openPlacesTab();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tavern' } });
    fireEvent.click(screen.getByRole('button', { name: /Add location/ }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const [worldId, payload] = create.mock.calls[0];
    expect(worldId).toBe('world-1');
    expect(payload.type).toBe('place');
    expect(payload.name).toBe('Tavern');
    expect(payload.document?.worldEntryId).toEqual(expect.any(String));
    expect(payload.document).not.toHaveProperty('libraryAssetId');
  });

  it('edits the existing canonical row by its library asset id', async () => {
    mockChildren();
    const update = vi.spyOn(libraryApi, 'updateWorldChild').mockResolvedValue({} as never);
    await openPlacesTab();

    fireEvent.click(screen.getByTitle('Edit'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grand Harbor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const [worldId, childId, payload] = update.mock.calls[0];
    expect(worldId).toBe('world-1');
    expect(childId).toBe('asset-harbor');
    expect(payload.name).toBe('Grand Harbor');
  });

  it('deletes the correct canonical child', async () => {
    mockChildren();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const remove = vi.spyOn(libraryApi, 'deleteWorldChild').mockResolvedValue(undefined);
    await openPlacesTab();

    fireEvent.click(screen.getByTitle('Delete'));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('world-1', 'asset-harbor'));
  });

  it('keeps Places out of the world root save payload', async () => {
    mockChildren();
    const updateAsset = vi.spyOn(libraryApi, 'updateAsset').mockResolvedValue(world);
    await openPlacesTab();

    fireEvent.click(screen.getByRole('button', { name: /Save world/ }));

    await waitFor(() => expect(updateAsset).toHaveBeenCalledTimes(1));
    const payload = updateAsset.mock.calls[0][1] as { document: Record<string, unknown> };
    expect(payload.document).not.toHaveProperty('locations');
    expect((payload.document.lore as Record<string, unknown>).history).toBe('Old history.');
  });
});
