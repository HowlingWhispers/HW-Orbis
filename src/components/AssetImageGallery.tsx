import { Images } from 'lucide-react';
import { assetImageUrl, coverAltText } from '../lib/asset-images';
import type { AssetImage } from '../types/library';

/** Detail-page gallery. Gallery images keep their own aspect ratio; only the card cover is cropped to 16:9. */
export function AssetImageGallery({ images }: { images: AssetImage[] }) {
  const gallery = images.filter((image) => image.kind === 'gallery');
  if (!gallery.length) return null;
  return (
    <section className="detail-gallery" aria-label="Record gallery">
      <header><Images size={16} /><h2>Gallery</h2><span>{gallery.length} image{gallery.length === 1 ? '' : 's'}</span></header>
      <div className="detail-gallery__grid">
        {gallery.map((image) => (
          <figure key={image.id}>
            <img src={assetImageUrl(image)} alt={coverAltText(image, 'this record')} loading="lazy" decoding="async" />
            {image.caption && <figcaption>{image.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </section>
  );
}
