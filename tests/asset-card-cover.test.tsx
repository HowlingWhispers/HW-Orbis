import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetCard } from '../src/components/AssetCard';
import { assetImageUrl, COVER_ASPECT_RATIO, coverAltText, coverObjectPosition } from '../src/lib/asset-images';
import type { AssetImage, LibraryAsset } from '../src/types/library';

afterEach(cleanup);

const cover: AssetImage = {
  id: '5d1f2a10-0000-4000-8000-000000000001', assetId: '27d31940-108b-4dde-975d-bd8c1a327f83',
  kind: 'cover', storageKind: 'local', url: '/v1/library/media/5d1f2a10-0000-4000-8000-000000000001',
  mimeType: 'image/png', byteSize: 4096, width: 1600, height: 900, focalX: 0.4, focalY: 0.3, position: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

function assetWith(overrides: Partial<LibraryAsset> = {}): LibraryAsset {
  return {
    id: '27d31940-108b-4dde-975d-bd8c1a327f83', type: 'place', name: 'Brackenjaw', summary: 'A wet delta town.',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', sourceType: 'user-created',
    contentRating: 'sfw', tags: ['Bitterroot'], dependencyCount: 2, visualTone: 'forest',
    ...overrides,
  };
}

const renderCard = (asset: LibraryAsset) => render(<MemoryRouter><AssetCard asset={asset} /></MemoryRouter>);

describe('card cover artwork', () => {
  it('fills a 16:9 card frame with the cover image', () => {
    const { container } = renderCard(assetWith({ coverImage: cover, imageCount: 1 }));
    const frame = container.querySelector('.asset-card__visual');
    const image = container.querySelector('.asset-card__cover');
    expect(frame).toHaveClass('has-cover');
    expect(image).toHaveAttribute('src', assetImageUrl(cover));
    expect(COVER_ASPECT_RATIO).toBeCloseTo(16 / 9, 5);
  });

  it('applies the stored focal point so a subject survives the crop', () => {
    renderCard(assetWith({ coverImage: cover }));
    expect(coverObjectPosition(cover)).toBe('40.00% 30.00%');
    expect(screen.getByRole('img')).toHaveStyle({ objectPosition: '40.00% 30.00%' });
  });

  it('centres a cover that has no focal point set', () => {
    expect(coverObjectPosition(undefined)).toBe('50.00% 50.00%');
    expect(coverObjectPosition({ ...cover, focalX: 9, focalY: -3 })).toBe('100.00% 0.00%');
  });

  it('uses descriptive alt text rather than an empty image label', () => {
    renderCard(assetWith({ coverImage: { ...cover, altText: '', caption: 'The ridge at dusk' } }));
    expect(screen.getByAltText('The ridge at dusk')).toBeInTheDocument();
    expect(coverAltText(undefined, 'Brackenjaw')).toBe('Cover artwork for Brackenjaw');
  });

  it('keeps the generated tone artwork when a record has no cover', () => {
    const { container } = renderCard(assetWith());
    expect(container.querySelector('.asset-card__visual')).not.toHaveClass('has-cover');
    expect(container.querySelector('.asset-card__cover')).toBeNull();
    expect(container.querySelector('.visual-orb')).toBeInTheDocument();
  });

  it('never renders artwork for a restricted record', () => {
    const { container } = renderCard(assetWith({ restricted: true, coverImage: cover, imageCount: 3, verificationPath: '/verification' }));
    expect(container.querySelector('.asset-card__cover')).toBeNull();
    expect(screen.getByRole('link', { name: 'Learn how to get verified' })).toHaveAttribute('href', '/verification');
  });

  it('flags the gallery size when a record has more than a cover', () => {
    renderCard(assetWith({ coverImage: cover, imageCount: 4 }));
    expect(screen.getByText('3 more')).toBeInTheDocument();
  });

  it('leaves external image URLs untouched', () => {
    expect(assetImageUrl({ ...cover, storageKind: 'external', url: 'https://example.com/cover.png' })).toBe('https://example.com/cover.png');
  });
});
