import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { libraryApi } from '../api/client';
import { libraryNavigation } from '../app/library-nav';
import { AssetCard } from '../components/AssetCard';
import { ErrorState, LoadingState } from '../components/StatePanel';
import { useLibraryData } from '../hooks/useLibraryData';
import { useI18n } from '../i18n/I18nContext';

const germanNavigation: Record<string, { label: string; description: string }> = {
  world: { label: 'Welten', description: 'Vollständig erstellte Realitäten und ihr Kanon.' },
  character: { label: 'Charaktere', description: 'Die Personen und Persönlichkeiten, die in ihnen leben.' },
  place: { label: 'Orte', description: 'Regionen, Wege, Zufluchtsorte und Räume.' },
  item: { label: 'Gegenstände', description: 'Objekte, Werkzeuge, Artefakte und Besitztümer.' },
  faction: { label: 'Fraktionen', description: 'Bündnisse, Clans und organisierte Kräfte.' },
  species: { label: 'Spezies', description: 'Völker, Formen und vererbte Merkmale.' },
  society: { label: 'Gesellschaften', description: 'Kulturen, Bräuche und Gemeinschaften.' },
  family: { label: 'Familien', description: 'Verwandtschaft, Haushalte und Blutlinien.' },
  memory: { label: 'Erinnerungen & Ereignisse', description: 'Momente, die eine Person oder Welt verändert haben.' },
};

export function HomeView() {
  const { data, error, loading, retry } = useLibraryData((signal) => libraryApi.getOverview(signal));
  const { locale } = useI18n();
  const de = locale === 'de';
  const bannerSrc = de ? '/assets/orbis-banner-de.webp' : '/assets/orbis-banner.webp';

  return (
    <div className="page home-page">
      <section className="banner-gate" aria-label={de ? 'Willkommen bei Orbis, der Bibliothek von Howling Whispers' : 'Welcome to Orbis, the Library of Howling Whispers'}>
        <img
          key={bannerSrc}
          src={bannerSrc}
          alt={de ? 'Coda heißt dich bei Orbis, der Bibliothek von Howling Whispers, willkommen' : 'Coda welcomes you to Orbis, the Library of Howling Whispers'}
          onError={(event) => {
            if (event.currentTarget.src.endsWith('/assets/orbis-banner.webp')) return;
            event.currentTarget.src = '/assets/orbis-banner.webp';
          }}
        />
      </section>

      <section className="section-block" id="shelves">
        <div className="section-heading"><div><span className="eyebrow">{de ? 'Finde deinen Weg' : 'Find your way'}</span><h2>{de ? 'Regale durchsuchen' : 'Browse the shelves'}</h2></div><Link to="/all">{de ? 'Alles anzeigen' : 'View everything'} <ArrowRight size={16} /></Link></div>
        <div className="category-grid">
          {libraryNavigation.map(({ type, label, description, icon: Icon }) => {
            const localized = de ? germanNavigation[type] : undefined;
            return (
              <Link className="category-tile" to={`/library/${type}`} key={type}>
                <span className="category-tile__icon"><Icon /></span>
                <span><strong>{localized?.label ?? label}</strong><small>{localized?.description ?? description}</small></span>
                <ArrowRight className="category-tile__arrow" size={17} />
                {data && <span className="category-tile__count">{data.counts[type]}</span>}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><span className="eyebrow">{de ? 'Kürzlich gepflegt' : 'Recently tended'}</span><h2>{de ? 'Frisch aus dem Archiv' : 'Fresh from the archive'}</h2></div></div>
        {loading && <LoadingState />}
        {error && <ErrorState retry={retry} />}
        {data && <div className="asset-grid">{data.recent.map((asset) => <AssetCard asset={asset} key={asset.id} />)}</div>}
      </section>

      <section className="quiet-note"><span className="quiet-note__paw">●</span><div><strong>{de ? 'Coda hält Wache.' : 'Coda is keeping watch.'}</strong><p>{de ? 'Deine Quelldatensätze bleiben beim Durchsuchen unverändert. Die Simulationsbereiche werden diese Geschichten später öffnen, sobald sie bereit sind.' : 'Your source records stay unchanged when you browse. The simulation wings will open these stories later, when they are ready.'}</p></div></section>
    </div>
  );
}
