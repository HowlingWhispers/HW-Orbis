import { MoonStar } from 'lucide-react';
import { Link } from 'react-router-dom';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" to="/" aria-label="Orbis home">
      <span className="brand__seal"><MoonStar size={20} strokeWidth={1.7} /></span>
      {!compact && (
        <span>
          <span className="brand__eyebrow">The Library of Howling Whispers</span>
          <span className="brand__name">Orbis</span>
        </span>
      )}
    </Link>
  );
}
