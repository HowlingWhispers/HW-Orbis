import { ChevronDown, Compass, Search } from 'lucide-react';
import { useState } from 'react';

type DocumentRecord = Record<string, unknown>;

type WorldPortalProps = {
  document?: DocumentRecord;
  worldName: string;
  summary?: string;
};

const TAB_PRIORITY = [
  'places',
  'locations',
  'regions',
  'characters',
  'people',
  'factions',
  'species',
  'societies',
  'families',
  'items',
  'lore',
  'history',
  'rules',
  'memories',
];

export function WorldPortal({ document, worldName, summary = '' }: WorldPortalProps) {
  const sections = document
    ? visibleEntries(document)
      .filter(([key]) => key !== 'identity')
      .sort(([left], [right]) => sectionRank(left) - sectionRank(right) || humanize(left).localeCompare(humanize(right)))
    : [];
  const [activeKey, setActiveKey] = useState('overview');
  const activeSection = sections.find(([key]) => key === activeKey);
  const showingOverview = activeKey === 'overview' || !activeSection;
  const identity = document && isRecord(document.identity) ? document.identity : undefined;

  return (
    <div className="world-portal">
      <header className="world-portal__header">
        <span className="eyebrow"><Compass size={14} /> World index</span>
        <h2>Explore {worldName}</h2>
        <p>Browse the world as a reference instead of reading one continuous lore stream. Open only the section you need, then expand individual records for detail.</p>
      </header>

      <div className="world-tabs" role="tablist" aria-label={`${worldName} world sections`}>
        <button
          type="button"
          role="tab"
          aria-selected={showingOverview}
          className={showingOverview ? 'is-active' : ''}
          onClick={() => setActiveKey('overview')}
        >
          Overview
        </button>
        {sections.map(([key, value]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={!showingOverview && activeKey === key}
            className={!showingOverview && activeKey === key ? 'is-active' : ''}
            onClick={() => setActiveKey(key)}
          >
            {humanize(key)}
            {collectionCount(value) !== undefined && <span>{collectionCount(value)}</span>}
          </button>
        ))}
      </div>

      <div className="world-tab-panel" role="tabpanel">
        {showingOverview
          ? <WorldOverview identity={identity} sections={sections} summary={summary} onOpen={setActiveKey} />
          : <WorldSection key={activeSection[0]} label={humanize(activeSection[0])} value={activeSection[1]} />}
      </div>
    </div>
  );
}

function WorldOverview({
  identity,
  sections,
  summary,
  onOpen,
}: {
  identity?: DocumentRecord;
  sections: [string, unknown][];
  summary: string;
  onOpen: (key: string) => void;
}) {
  const intro = firstString(identity?.description) || summary;
  const identityFacts = identity
    ? visibleEntries(identity)
      .filter(([key, value]) => key !== 'description' && !isRecord(value) && !Array.isArray(value))
      .slice(0, 4)
    : [];
  const countable = sections
    .map(([key, value]) => ({ key, label: humanize(key), count: collectionCount(value) }))
    .filter((entry): entry is { key: string; label: string; count: number } => entry.count !== undefined && entry.count > 0)
    .slice(0, 8);

  return (
    <div className="world-overview">
      {intro && <p className="world-overview__intro">{intro}</p>}

      {identityFacts.length > 0 && <div className="world-overview__facts">
        {identityFacts.map(([key, value]) => <div key={key}><small>{humanize(key)}</small><strong>{displayScalar(value)}</strong></div>)}
      </div>}

      {countable.length > 0 && <section className="world-overview__stats" aria-label="World at a glance">
        <header><span className="eyebrow">World at a glance</span><h3>What lives in this archive</h3></header>
        <div>
          {countable.map((entry) => <button key={entry.key} type="button" onClick={() => onOpen(entry.key)}><strong>{entry.count}</strong><span>{entry.label}</span></button>)}
        </div>
      </section>}

      {sections.length > 0 && <section className="world-overview__browse">
        <header><span className="eyebrow">Browse</span><h3>Choose a part of the world</h3></header>
        <div className="world-overview__grid">
          {sections.map(([key, value]) => <button key={key} type="button" className="world-overview-card" onClick={() => onOpen(key)}>
            <span className="world-overview-card__title">{humanize(key)}</span>
            {collectionCount(value) !== undefined && <strong>{collectionCount(value)} {collectionCount(value) === 1 ? 'entry' : 'entries'}</strong>}
            <p>{previewValue(value)}</p>
          </button>)}
        </div>
      </section>}
    </div>
  );
}

function WorldSection({ label, value }: { label: string; value: unknown }) {
  const recordCollection = Array.isArray(value) && value.length > 0 && value.every(isRecord);
  const [query, setQuery] = useState('');

  if (recordCollection) {
    const records = value as DocumentRecord[];
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? records.filter((record) => JSON.stringify(record).toLowerCase().includes(normalizedQuery))
      : records;

    return (
      <section className="world-section">
        <WorldSectionHeading label={label} count={records.length} />
        {records.length >= 5 && <label className="world-section__search">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}...`}
            aria-label={`Search ${label}`}
          />
          {normalizedQuery && <span>{filtered.length}/{records.length}</span>}
        </label>}
        <div className="world-accordion-stack">
          {filtered.map((record, index) => <WorldRecordAccordion key={`${recordTitle(record) || label}-${index}`} record={record} fallback={`${singularize(label)} ${index + 1}`} />)}
          {filtered.length === 0 && <p className="world-section__empty">Nothing in this section matches “{query.trim()}”.</p>}
        </div>
      </section>
    );
  }

  if (isRecord(value)) {
    const entries = visibleEntries(value);
    return (
      <section className="world-section">
        <WorldSectionHeading label={label} count={entries.length} />
        <div className="world-accordion-stack">
          {entries.map(([key, childValue]) => <WorldValueAccordion key={key} label={humanize(key)} value={childValue} />)}
        </div>
      </section>
    );
  }

  return (
    <section className="world-section">
      <WorldSectionHeading label={label} count={Array.isArray(value) ? value.length : undefined} />
      <div className="world-section__plain"><WorldValueBody value={value} /></div>
    </section>
  );
}

function WorldSectionHeading({ label, count }: { label: string; count?: number }) {
  return <header className="world-section__heading"><div><span className="eyebrow">World reference</span><h3>{label}</h3></div>{count !== undefined && <span>{count} {count === 1 ? 'entry' : 'entries'}</span>}</header>;
}

function WorldRecordAccordion({ record, fallback }: { record: DocumentRecord; fallback: string }) {
  const title = recordTitle(record) || fallback;
  const kind = recordKind(record);
  const preview = recordPreview(record);

  return (
    <details className="world-accordion">
      <summary>
        <span className="world-accordion__summary-copy">
          {kind && <small>{kind}</small>}
          <strong>{title}</strong>
          {preview && <span>{preview}</span>}
        </span>
        <ChevronDown className="world-accordion__chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="world-accordion__body"><WorldRecordFields record={record} /></div>
    </details>
  );
}

function WorldValueAccordion({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="world-accordion">
      <summary>
        <span className="world-accordion__summary-copy">
          <strong>{label}</strong>
          <span>{previewValue(value)}</span>
        </span>
        <ChevronDown className="world-accordion__chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="world-accordion__body"><WorldValueBody value={value} /></div>
    </details>
  );
}

function WorldRecordFields({ record }: { record: DocumentRecord }) {
  const entries = visibleEntries(record, true);
  if (!entries.length) return <p className="world-section__empty">No additional authored detail is stored for this record.</p>;

  return <div className="world-field-grid">{entries.map(([key, value]) => <WorldField key={key} label={humanize(key)} value={value} />)}</div>;
}

function WorldField({ label, value }: { label: string; value: unknown }) {
  const wide = isRecord(value) || Array.isArray(value) || (typeof value === 'string' && value.length > 120);
  return <div className={`world-field${wide ? ' world-field--wide' : ''}`}><h4>{label}</h4><WorldValueBody value={value} /></div>;
}

function WorldValueBody({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <p>None recorded.</p>;
    const records = value.filter(isRecord);
    if (records.length === value.length) {
      return <div className="world-subrecord-stack">{records.map((record, index) => <WorldRecordAccordion key={`${recordTitle(record) || 'record'}-${index}`} record={record} fallback={`Record ${index + 1}`} />)}</div>;
    }
    return <ul className="document-list">{value.map((item, index) => <li key={index}>{displayScalar(item)}</li>)}</ul>;
  }

  if (isRecord(value)) return <WorldRecordFields record={value} />;
  return <p>{displayScalar(value)}</p>;
}

function visibleEntries(document: DocumentRecord, insideRecord = false) {
  return Object.entries(document).filter(([key, value]) => {
    if (!hasValue(value) || isTechnicalKey(key) || key === 'name' || key === 'title') return false;
    if (insideRecord && (key === 'kind' || key === 'type')) return false;
    return true;
  });
}

function sectionRank(key: string) {
  const normalized = key.toLowerCase();
  const priority = TAB_PRIORITY.indexOf(normalized);
  return priority === -1 ? TAB_PRIORITY.length + 1 : priority;
}

function collectionCount(value: unknown) {
  if (Array.isArray(value)) return value.length;
  if (isRecord(value)) return visibleEntries(value).length;
  return undefined;
}

function previewValue(value: unknown) {
  if (Array.isArray(value)) {
    const labels = value.slice(0, 3).map((item) => isRecord(item) ? recordTitle(item) || recordKind(item) : displayScalar(item)).filter(Boolean);
    if (labels.length > 0) return `${labels.join(' · ')}${value.length > labels.length ? ' …' : ''}`;
    return `${value.length} entries`;
  }

  if (isRecord(value)) {
    const description = firstString(value.description) || firstString(value.summary) || firstString(value.note);
    if (description) return truncate(description, 150);
    const labels = visibleEntries(value).slice(0, 3).map(([key]) => humanize(key));
    return labels.length ? labels.join(' · ') : 'Structured world information';
  }

  return truncate(displayScalar(value), 150);
}

function recordPreview(record: DocumentRecord) {
  return truncate(
    firstString(record.description)
    || firstString(record.summary)
    || firstString(record.note)
    || firstString(record.identity && isRecord(record.identity) ? record.identity.description : undefined),
    180,
  );
}

function recordTitle(document: DocumentRecord) {
  if (firstString(document.name)) return firstString(document.name);
  if (firstString(document.title)) return firstString(document.title);
  if (isRecord(document.identity) && firstString(document.identity.name)) return firstString(document.identity.name);
  return '';
}

function recordKind(document: DocumentRecord) {
  const value = firstString(document.kind) || firstString(document.type);
  return value ? humanize(value) : '';
}

function firstString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isRecord(value: unknown): value is DocumentRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasValue(value: unknown) {
  return value !== '' && value != null && (!Array.isArray(value) || value.length > 0);
}

function isTechnicalKey(key: string) {
  return key === 'id' || key === 'sourceId' || /Ids?$/.test(key);
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function singularize(value: string) {
  return value.endsWith('ies') ? `${value.slice(0, -3)}y` : value.endsWith('s') ? value.slice(0, -1) : value;
}

function truncate(value: string, maxLength: number) {
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;
}

function displayScalar(value: unknown) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && /^[a-z0-9-]+(?:_[a-z0-9-]+)+$/i.test(value)) return humanize(value);
  if (value == null) return '';
  return String(value);
}
