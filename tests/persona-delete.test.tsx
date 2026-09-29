import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { libraryApi } from '../src/api/client';
import { AssetDetailView } from '../src/views/AssetDetailView';
import type { LibraryAsset } from '../src/types/library';
vi.mock('../src/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('../src/components/AssetImageGallery', () => ({ AssetImageGallery: () => null }));
vi.mock('../src/hooks/useSEO', () => ({ useSEO: () => {} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const persona = { id: 'persona-1', type: 'persona', name: 'Traveler', summary: 'A traveler', tags: [], document: {}, canEdit: true, visualTone: 'mist', dependencyCount: 0, createdAt: '2026-09-28', updatedAt: '2026-09-28' } as unknown as LibraryAsset;
function open(canEdit = true) {
  vi.spyOn(libraryApi, 'getAsset').mockResolvedValue({ ...persona, canEdit });
  render(<MemoryRouter initialEntries={['/asset/persona-1']}><Routes><Route path="/asset/:id" element={<AssetDetailView />} /><Route path="/library/persona" element={<p>Persona library</p>} /></Routes></MemoryRouter>);
}
describe('Persona deletion', () => {
  it('requires confirmation and returns to the library after successful deletion', async () => {
    const remove = vi.spyOn(libraryApi, 'deleteAsset').mockResolvedValue();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    open();
    const button = await screen.findByRole('button', { name: 'Delete Persona' });
    fireEvent.click(button);
    expect(remove).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(button);
    expect(await screen.findByText('Persona library')).toBeInTheDocument();
    expect(remove).toHaveBeenCalledWith('persona-1');
  });
  it('shows server errors and permits retry without leaving the record', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(libraryApi, 'deleteAsset').mockRejectedValue(new Error('Deletion failed'));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Persona' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Deletion failed');
    expect(screen.getByRole('button', { name: 'Delete Persona' })).toBeEnabled();
  });
  it('does not offer deletion for another user’s Persona', async () => {
    open(false);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Traveler' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Delete Persona' })).toBeNull();
  });
  it('does not offer Speculus launch from a Persona record', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Traveler' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Simulate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Simulate from here' })).toBeNull();
  });
});
