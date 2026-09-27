import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { PublicChangelogEntry, PublicChangelogSection } from '../types/changelog';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function formatPublishedDate(publishedAt: string) {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export type WhatsNewDialogProps = {
  open: boolean;
  /** Every entry newer than the account's acknowledgement, newest first. */
  entries: PublicChangelogEntry[];
  onAcknowledge: (version: string) => Promise<void>;
  onDismiss: () => void;
};

/**
 * The "What's New" bulletin.
 *
 * Accessibility and failure behaviour are the two things this component is
 * careful about:
 * - focus is trapped while open and restored to the opener on close
 * - Escape and the X button dismiss WITHOUT acknowledging, so the update
 *   legitimately reappears next visit; only ROGER records the acknowledgement
 * - if acknowledging fails, the dialog still closes and Orbis keeps working
 */
export function WhatsNewDialog({ open, entries, onAcknowledge, onDismiss }: WhatsNewDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [acknowledgementError, setAcknowledgementError] = useState('');

  const newest = entries[0];
  const headlineDate = newest ? formatPublishedDate(newest.publishedAt) : '';

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    return () => {
      // Restore focus to whatever opened the bulletin, if it is still mounted.
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      setAcknowledgementError('');
    }
  }, [open]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onDismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const node = dialogRef.current;
    if (!node) return;
    const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !node.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onDismiss]);

  const jumpTo = useCallback((sectionId: string) => {
    const target = bodyRef.current?.querySelector<HTMLElement>(`[data-section="${sectionId}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
  }, []);

  const acknowledge = useCallback(async () => {
    if (!newest || busy) return;
    setBusy(true);
    setAcknowledgementError('');
    try {
      await onAcknowledge(newest.version);
      onDismiss();
    } catch {
      // A failed acknowledgement must never trap the member in the dialog.
      setAcknowledgementError('Orbis could not record that you have read this update. It may appear again.');
      onDismiss();
    } finally {
      setBusy(false);
    }
  }, [busy, newest, onAcknowledge, onDismiss]);

  if (!open) return null;

  // Only offer navigation for sections that actually exist, de-duplicated
  // across every entry being shown.
  const sections: PublicChangelogSection[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const section of entry.sections) {
      if (seen.has(section.id)) continue;
      seen.add(section.id);
      sections.push(section);
    }
  }

  return <div className="whats-new-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
    <div
      className="whats-new"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={dialogRef}
      onKeyDown={onKeyDown}
    >
      <header className="whats-new__header">
        <div>
          <span className="eyebrow">Orbis update ledger</span>
          <h2 id={titleId}>What's New in Orbis</h2>
          {headlineDate && <p className="whats-new__date">{headlineDate}{entries.length > 1 ? ` · ${entries.length} updates since your last visit` : ''}</p>}
        </div>
        <button type="button" className="icon-button" onClick={onDismiss} aria-label="Close without acknowledging">
          <X size={20} />
        </button>
      </header>

      {sections.length > 1 && <nav className="whats-new__nav" aria-label="Jump to section">
        <button type="button" className="whats-new__nav-item is-current" onClick={() => { bodyRef.current?.scrollTo({ top: 0, behavior: 'auto' }); }}>Latest</button>
        {sections.map((section) => <button key={section.id} type="button" className="whats-new__nav-item" onClick={() => jumpTo(section.id)}>{section.title}</button>)}
      </nav>}

      <div className="whats-new__body" ref={bodyRef} tabIndex={0}>
        {entries.map((entry, entryIndex) => <article key={entry.version} className="whats-new__entry">
          <h3 className="whats-new__entry-title">{entry.title}</h3>
          {entryIndex > 0 && <p className="whats-new__entry-date">{formatPublishedDate(entry.publishedAt)}</p>}
          {entry.sections.map((section) => <section key={section.id} className="whats-new__section" data-section={section.id} tabIndex={-1}>
            <h4>{section.title}</h4>
            <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>)}
        </article>)}
      </div>

      <footer className="whats-new__footer">
        <p className="whats-new__hint">Press <kbd>ROGER</kbd> when you have read this. Closing with the X or Escape will show it again next time.</p>
        {acknowledgementError && <p className="form-message" role="alert">{acknowledgementError}</p>}
        <button type="button" className="button button--primary whats-new__roger" onClick={() => void acknowledge()} disabled={busy || !newest}>
          ROGER
        </button>
      </footer>
    </div>
  </div>;
}
