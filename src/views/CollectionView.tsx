import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { libraryApi } from '../api/client';
import { findNavigationItem } from '../app/library-nav';
import { AssetCard } from '../components/AssetCard';
import { EmptyState, ErrorState, LoadingState } from '../components/StatePanel';
import { useLibraryData } from '../hooks/useLibraryData';
import { useI18n } from '../i18n/I18nContext';
import type { AssetType, SourceType } from '../types/library';

const germanCollection: Record<string, { label: string; description: string }> = {
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

export function CollectionView({ all = false }: { all?: boolean }) {
  const { type } = useParams();
  const navigation = findNavigationItem(type);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [source, setSource] = useState<SourceType | ''>('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const selectedType = all ? undefined : navigation?.type;
  const query = useMemo(() => ({ type: selectedType as AssetType | undefined, search: searchParams.get('search') ?? '', sourceType: source || undefined, sort }), [selectedType, searchParams, source, sort]);
  const loader = useCallback((signal: AbortSignal) => libraryApi.listAssets(query, signal), [query]);
  const { data, error, loading, retry } = useLibraryData(loader, [loader]);
  const { locale } = useI18n();
  const de = locale === 'de';
  const Icon = navigation?.icon;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    search.trim() ? next.set('search', search.trim()) : next.delete('search');
    setSearchParams(next);
  };

  const localizedNavigation = navigation && de ? germanCollection[navigation.type] : undefined;
  const title = all ? (de ? 'Das vollständige Archiv' : 'The complete archive') : localizedNavigation?.label ?? navigation?.label ?? (de ? 'Unbekanntes Regal' : 'Unknown shelf');
  const description = all
    ? (de ? 'Jeder Datensatz aus jedem Regal, von einem ruhigen Ort aus durchsuchbar.' : 'Every record across every shelf, ready to search from one quiet place.')
    : localizedNavigation?.description ?? navigation?.description;

  return (
    <div className="page collection-page">
      <header className="collection-header">
        <div className="collection-header__icon">{Icon ? <Icon /> : <span className="all-shelves-icon">✦</span>}</div>
        <div><span className="eyebrow">{all ? (de ? 'Alle Sammlungen' : 'All collections') : (de ? 'Coda-Sammlung' : 'Coda collection')}</span><h1>{title}</h1><p>{description}</p></div>
        <span className="collection-header__count">{data?.total ?? '...'} <small>{de ? 'Datensätze' : 'records'}</small></span>
      </header>

      <div className="filter-bar">
        <form className="collection-search" onSubmit={submit}><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={de ? `${all ? 'Archiv' : title} durchsuchen...` : `Search ${all ? 'the archive' : title.toLocaleLowerCase()}...`} /></form>
        <label className="select-control"><SlidersHorizontal size={16} /><select value={source} onChange={(event) => setSource(event.target.value as SourceType | '')}><option value="">{de ? 'Alle Quellen' : 'All sources'}</option><option value="curated">{de ? 'Kuratiert' : 'Curated'}</option><option value="user-created">{de ? 'Von Nutzern erstellt' : 'User created'}</option><option value="imported-v2">{de ? 'Importiert V2' : 'Imported V2'}</option><option value="copied">{de ? 'Kopiert' : 'Copied'}</option></select><ChevronDown size={15} /></label>
        <label className="select-control"><span>{de ? 'Sortieren:' : 'Sort:'}</span><select value={sort} onChange={(event) => setSort(event.target.value as 'recent' | 'name')}><option value="recent">{de ? 'Zuletzt bearbeitet' : 'Recently edited'}</option><option value="name">{de ? 'Name' : 'Name'}</option></select><ChevronDown size={15} /></label>
      </div>

      {loading && <LoadingState label={de ? 'Regale werden durchsucht...' : 'Searching the shelves...'} />}
      {error && <ErrorState retry={retry} />}
      {data && data.items.length === 0 && <EmptyState search={query.search} />}
      {data && data.items.length > 0 && <div className="asset-grid asset-grid--collection">{data.items.map((asset) => <AssetCard asset={asset} key={asset.id} />)}</div>}
    </div>
  );
}
