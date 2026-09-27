import { useEffect, useState } from 'react';
import { acknowledgeChangelog, fetchPublicChangelog } from '../api/changelog';
import type { PublicChangelogEntry } from '../types/changelog';

/**
 * Decide whether the "What's New" bulletin should open for this account.
 *
 * The changelog is the one feature that is never allowed to interfere with
 * using Orbis. Every failure path here resolves to "show nothing": a failed
 * fetch, a signed-out visitor, an unreadable acknowledgement, or a database
 * problem all result in the Library loading exactly as it otherwise would.
 */
export function useWhatsNew(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<PublicChangelogEntry[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchPublicChangelog(controller.signal)
      .then((payload) => {
        // `unreadVersions` is null when Orbis could not determine what this
        // account has already read. Skipping the popup is correct there: showing
        // an acknowledged update is worse than not showing an unread one.
        if (!payload.unreadVersions?.length) return;
        const unread = new Set(payload.unreadVersions);
        const matched = payload.entries.filter((entry) => unread.has(entry.version));
        if (!matched.length) return;
        setEntries(matched);
        setOpen(true);
      })
      .catch(() => {
        // Silent by design. The changelog is never a reason to fail app entry.
      });
    return () => controller.abort();
  }, [enabled]);

  const acknowledge = async (version: string) => {
    await acknowledgeChangelog(version);
    setEntries([]);
  };

  return { open, entries, acknowledge, dismiss: () => setOpen(false) };
}
