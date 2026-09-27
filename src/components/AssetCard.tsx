import { Archive, ArrowUpRight, Boxes, MapPin, Pin, Sparkles, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LibraryAsset } from '../types/library';
import { findNavigationItem } from '../app/library-nav';
import { assetImageUrl, coverAltText, coverObjectPosition } from '../lib/asset-images';

const sourceLabels: Record<LibraryAsset['sourceType'], string> = {
  curated: 'Curated',
  'user-created': 'User created',
  'imported-v2': 'Imported V2',
  copied: 'Copied',
  'public-curated': 'Public source',
  'legacy-import': 'Legacy import',
};

export function AssetCard({ asset, featured = false }: { asset: LibraryAsset; featured?: boolean }) {
  const category = findNavigationItem(asset.type);
  const Icon = category?.icon;
  const target = asset.restricted ? asset.verificationPath ?? '/verification' : `/asset/${asset.id}`;
  const coverUrl = asset.restricted ? '' : assetImageUrl(asset.coverImage);
  return (
    <article className={`asset-card tone-${asset.visualTone} ${featured ? 'asset-card--featured' : ''}`}>
      <Link className={`asset-card__visual ${coverUrl ? 'has-cover' : ''}`} to={target} aria-label={asset.restricted ? 'Learn how to get verified' : `Open ${asset.name}`}>
        {coverUrl && <img className="asset-card__cover" src={coverUrl} alt={coverAltText(asset.coverImage, asset.name)} style={{ objectPosition: coverObjectPosition(asset.coverImage) }} loading="lazy" decoding="async" />}
        {!coverUrl && <><span className="visual-orb" /><span className="visual-ridge visual-ridge--back" /><span className="visual-ridge visual-ridge--front" /></>}
        <span className="asset-card__scrim" />
        <span className="asset-card__type">{Icon && <Icon size={14} />} {category?.shortLabel}</span>
        {asset.pinned && <span className="asset-card__pin"><Pin size={13} /> Pinned</span>}
        {(asset.imageCount ?? 0) > 1 && <span className="asset-card__gallery-count">{(asset.imageCount ?? 0) - 1} more</span>}
      </Link>
      <div className="asset-card__body">
        <div className="asset-card__title-row">
          <div><span className="asset-card__source">{asset.restricted ? 'Protected record' : sourceLabels[asset.sourceType]}</span><h3><Link to={target}>{asset.name}</Link></h3></div>
        </div>
        <p>{asset.summary}</p>
        <div className="asset-card__meta">
          {asset.originWorldName && <span><MapPin size={13} /> {asset.originWorldName}</span>}
          {asset.author && <span><UserRound size={13} /> {asset.author.displayName}</span>}
          <span><Boxes size={13} /> {asset.dependencyCount} links</span>
        </div>
        <div className="asset-card__footer">
          <div className="tag-row">{asset.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div>
          {!asset.restricted && asset.type === 'world' && asset.canEdit && <Link className="world-save-archive-link" to={`/asset/${asset.id}/edit?coda=1`} aria-label={`Edit ${asset.name} with Coda`}><Sparkles size={15} /> Edit with Coda</Link>}
          {!asset.restricted && asset.type === 'world' && <Link className="world-save-archive-link" to={`/asset/${asset.id}/saves`} aria-label={`Open ${asset.name} save archive`}><Archive size={15} /> Save Archive</Link>}
          <Link className="card-open" to={target} aria-label={asset.restricted ? 'Open verification guide' : `View ${asset.name}`}><ArrowUpRight size={18} /></Link>
        </div>
      </div>
    </article>
  );
}
