/**
 * The public Orbis changelog.
 *
 * This is a hand-curated data source. It is deliberately NOT generated from
 * `docs/CHANGELOG.md`: that document carries architecture, migrations, admin
 * and recovery mechanics, and deployment notes that users have no need to see.
 * Entries here are written from the user's point of view and must stay that
 * way.
 *
 * Sanitization rules for anything added to this file:
 * - describe what visibly changed, not how it is implemented
 * - refer to worlds generically ("worlds", "imported worlds", "world-linked
 *   Places"); never name a private world or quote its contents
 * - never include user IDs, Discord IDs, database or connection details,
 *   credentials, tokens, server paths, backups, or migration internals
 * - never advertise site-owner, super-admin, moderation, recovery or repair
 *   capabilities, even when they exist in the code
 * - if a change only affects operators, it does not belong here at all
 *
 * `tests/changelog.test.ts` fails the build if a forbidden pattern appears in
 * this file, so treat that check as a real gate rather than a formality.
 */

export type PublicChangelogSection = {
  /** Stable anchor slug. Used by the in-popup section navigation. */
  id: string;
  title: string;
  items: string[];
};

export type PublicChangelogEntry = {
  /**
   * Machine-readable version. Compared against the account's acknowledged
   * version to decide whether the What's New popup should open; never derive
   * acknowledgement from the displayed date.
   *
   * Format `YYYY.MM.DD.N`, which sorts correctly as a plain string and is
   * readable at a glance in a support conversation.
   */
  version: string;
  publishedAt: string;
  title: string;
  sections: PublicChangelogSection[];
};

export type PublicChangelogPayload = {
  latest: PublicChangelogEntry;
  entries: PublicChangelogEntry[];
  /**
   * Versions newer than this account's acknowledgement, newest first. `null`
   * when there is no signed-in account, or when the acknowledgement could not
   * be read — in both cases the UI skips the automatic notice rather than
   * guessing. The browser never re-implements version ordering.
   */
  unreadVersions: string[] | null;
};

/** Newest first. Add new entries at the top. */
export const publicChangelogEntries: PublicChangelogEntry[] = [
  {
    version: '2026.09.28.2',
    publishedAt: '2026-09-28T15:52:13.000Z',
    title: 'Speculus fits a phone, and Personas you no longer want can be deleted',
    sections: [
      {
        id: 'speculus',
        title: 'Speculus',
        items: [
          'Speculus 0.4.2 has a layout built for phones, so playing on a small screen no longer feels like a shrunk desktop.',
          'You can start a new line while typing, instead of the input sending your message the moment you press enter.',
        ],
      },
      {
        id: 'personas',
        title: 'Personas',
        items: [
          'You can now delete a Persona you no longer want, from the place you create and edit Personas.',
        ],
      },
    ],
  },
  {
    version: '2026.09.28.1',
    publishedAt: '2026-09-28T00:00:00.000Z',
    title: 'One source of truth for Places, and a Persona for every simulation',
    sections: [
      {
        id: 'world-forge',
        title: 'World Forge',
        items: [
          'Places now use one canonical source of truth, so the place you edit is the place everything else sees.',
          'Saving a world can no longer overwrite or delete newer Place records.',
          'Adding, renaming, moving and deleting a Place in World Forge now takes effect immediately, and survives a reload.',
          'World Forge, Coda and simulation all read the same Place records, so a change made in one shows up in the others.',
        ],
      },
      {
        id: 'personas',
        title: 'Personas',
        items: [
          'You can now choose a Persona when launching a simulation instead of being placed in a default one.',
          'The picker only shows Personas you own, plus Personas their owner has explicitly shared for use.',
          'The Persona you choose is what Speculus receives for that simulation.',
          'Each save keeps its own runtime state, so the same Persona can be reused across saves and worlds without state leaking between them.',
          'A Persona is still the player you play. The simulator does not invent your actions, dialogue or thoughts unless you hand over control.',
        ],
      },
      {
        id: 'coda',
        title: 'Coda',
        items: [
          'Coda creates and edits the same Place records you see in World Forge, so its results no longer drift from your own edits.',
          'Coda can no longer replace a world\'s places wholesale, which protects your authored data.',
          'When Coda cannot make a safe change, it says so instead of reporting a save that did not happen.',
        ],
      },
      {
        id: 'speculus',
        title: 'Speculus',
        items: [
          'Speculus now launches with your selected Persona rather than a generic stand-in.',
          'Launching from a saved game lets you pick a Persona again, and Orbis re-checks access each time.',
        ],
      },
      {
        id: 'imports',
        title: 'Imports',
        items: [
          'Imported Places are now stored in the same way as Places you create yourself.',
          'Re-running an import no longer overwrites world data you have since edited.',
          'An import can no longer leave a record behind without a world to belong to.',
        ],
      },
      {
        id: 'reliability',
        title: 'Reliability',
        items: [
          'Stronger validation of world data: malformed collections are refused instead of being silently discarded.',
          'Improved consistency when loading and saving world-linked records.',
          'Better protection against stale or conflicting data being written over newer content.',
        ],
      },
    ],
  },
];

/**
 * Compare two changelog versions.
 *
 * Returns a positive number when `left` is newer, negative when it is older,
 * and zero when they are equal. Unknown or unparseable versions sort oldest, so
 * a malformed acknowledgement can never hide a real update.
 */
export function compareChangelogVersions(left: string, right: string) {
  const parse = (value: string) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The newest published entry. */
export function latestChangelogEntry(): PublicChangelogEntry {
  const first = publicChangelogEntries[0];
  if (!first) throw new Error('The public Orbis changelog has no entries.');
  return first;
}

/** Every entry newer than `acknowledgedVersion`, newest first. */
export function unreadChangelogEntries(acknowledgedVersion: string | null | undefined): PublicChangelogEntry[] {
  if (!acknowledgedVersion) return [...publicChangelogEntries];
  return publicChangelogEntries.filter((entry) => compareChangelogVersions(entry.version, acknowledgedVersion) > 0);
}
