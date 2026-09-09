import { ArrowUpRight, Boxes, MapPin, MoreHorizontal, Pin, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LibraryAsset } from '../types/library';
import { findNavigationItem } from '../app/library-nav';

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
  return (
    <article className={`asset-card tone-${asset.visualTone} ${featured ? 'asset-card--featured' : ''}`}>
      <Link className="asset-card__visual" to={target} aria-label={asset.restricted ? 'Learn how to get verified' : `Open ${asset.name}`}>
        <span className="visual-orb" />
        <span className="visual-ridge visual-ridge--back" />
        <span className="visual-ridge visual-ridge--front" />
        <span className="asset-card__type">{Icon && <Icon size={14} />} {category?.shortLabel}</span>
        {asset.pinned && <span className="asset-card__pin"><Pin size={13} /> Pinned</span>}
      </Link>
      <div className="asset-card__body">
        <div className="asset-card__title-row">
          <div><span className="asset-card__source">{asset.restricted ? 'Protected record' : sourceLabels[asset.sourceType]}</span><h3><Link to={target}>{asset.name}</Link></h3></div>
          {!asset.restricted && <button className="icon-button" aria-label={`More actions for ${asset.name}`}><MoreHorizontal size={19} /></button>}
        </div>
        <p>{asset.summary}</p>
        <div className="asset-card__meta">
          {asset.originWorldName && <span><MapPin size={13} /> {asset.originWorldName}</span>}
          {asset.author && <span><UserRound size={13} /> {asset.author.displayName}</span>}
          <span><Boxes size={13} /> {asset.dependencyCount} links</span>
        </div>
        <div className="asset-card__footer">
          <div className="tag-row">{asset.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div>
          <Link className="card-open" to={target} aria-label={asset.restricted ? 'Open verification guide' : `View ${asset.name}`}><ArrowUpRight size={18} /></Link>
        </div>
      </div>
    </article>
  );
}
