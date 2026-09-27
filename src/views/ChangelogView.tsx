import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPublicChangelog } from '../api/changelog';
import { useSEO } from '../hooks/useSEO';
import type { PublicChangelogPayload } from '../types/changelog';

function formatPublishedDate(publishedAt: string) {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * The permanent public changelog. It always shows the full history, whether or
 * not the member has acknowledged anything, and it degrades to a plain message
 * rather than an error screen if the changelog cannot be loaded.
 */
export function ChangelogView() {
  const [payload, setPayload] = useState<PublicChangelogPayload | null>(null);
  const [error, setError] = useState('');

  useSEO({
    title: 'Changelog | Orbis — Library of Howling Whispers',
    description: 'What has changed in Orbis: World Forge, Coda, Personas, Speculus, imports and reliability.',
    canonicalPath: '/changelog',
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicChangelog(controller.signal)
      .then(setPayload)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError('Orbis could not load the changelog right now. Everything else still works.');
      });
    return () => controller.abort();
  }, []);

  return <div className="page changelog-page">
    <header className="changelog-page__header">
      <span className="eyebrow">Orbis update ledger</span>
      <h1>Changelog</h1>
      <p>What has changed in Orbis, newest first.</p>
    </header>

    {error && <p className="form-message" role="alert">{error}</p>}
    {!payload && !error && <p role="status">Loading the changelog...</p>}

    {payload && payload.entries.map((entry) => <article key={entry.version} className="changelog-page__entry">
      <h2>{formatPublishedDate(entry.publishedAt)}</h2>
      <p className="changelog-page__title">{entry.title}</p>
      {entry.sections.map((section) => <section key={section.id}>
        <h3>{section.title}</h3>
        <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>)}
    </article>)}

    <p className="changelog-page__back"><Link className="button button--ghost" to="/">Return to the Library</Link></p>
  </div>;
}
