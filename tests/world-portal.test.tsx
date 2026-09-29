import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorldPortal } from '../src/components/WorldPortal';

afterEach(() => cleanup());

const document = {
  identity: {
    name: 'Bitterroot',
    genre: 'Dark fantasy',
    tone: 'Intimate, dangerous, hopeful',
    description: 'A vast living world of forests, mountains, settlements and old roads.',
  },
  places: [
    { name: 'Hollowmere', kind: 'settlement', description: 'A market settlement with roads into the surrounding wilds.' },
    { name: 'Whispering Woods', kind: 'region', description: 'A misted forest threaded with old paths.' },
  ],
  species: [
    { name: 'Foxfolk', description: 'Anthropomorphic fox peoples.' },
    { name: 'Bearfolk', description: 'Anthropomorphic bear peoples.' },
  ],
  lore: {
    history: 'Old floods and changing trails shaped the region.',
    customs: 'Customs vary by place and people.',
  },
};

describe('world portal', () => {
  it('starts as a compact overview instead of rendering the entire world document', () => {
    render(<WorldPortal document={document} worldName="Bitterroot" summary="Fallback summary" />);

    expect(screen.getByRole('heading', { name: 'Explore Bitterroot' })).toBeVisible();
    expect(screen.getByText(/A vast living world/)).toBeVisible();
    expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Places/ })).toBeVisible();
    expect(screen.queryByText('Hollowmere')).not.toBeInTheDocument();
  });

  it('opens a category and filters large record collections without leaving the world page', () => {
    render(<WorldPortal document={document} worldName="Bitterroot" />);

    fireEvent.click(screen.getByRole('tab', { name: /Places/ }));
    expect(screen.getByText('Hollowmere')).toBeVisible();
    expect(screen.getByText('Whispering Woods')).toBeVisible();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Places' }), { target: { value: 'whisper' } });
    expect(screen.queryByText('Hollowmere')).not.toBeInTheDocument();
    expect(screen.getByText('Whispering Woods')).toBeVisible();
    expect(screen.getByText('1/2')).toBeVisible();
  });
});
