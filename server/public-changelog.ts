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
    version: '2026.09.29.2',
    publishedAt: '2026-09-29T19:03:00.000Z',
    title: 'A smaller, more flexible Speculus launch setup',
    sections: [
      {
        id: 'speculus',
        title: 'Speculus',
        items: [
          'Persona and starting Place choices now use compact dropdown menus instead of long radio-button lists.',
          'A launch can now choose World default, Family-friendly, Mature, or Adult / erotic tone, plus optional focus tags and a short direction prompt.',
          'Tone, tags and direction apply only to that simulation session and do not rewrite the world or character canon.',
          'Adult / erotic tone is only available with 18+ access and a Persona whose authored age is explicitly 18 or older.',
        ],
      },
    ],
  },
  {
    version: '2026.09.29.1',
    publishedAt: '2026-09-29T16:19:00.000Z',
    title: 'Choose where a Speculus simulation begins',
    sections: [
      {
        id: 'speculus',
        title: 'Speculus',
        items: [
          'Starting a simulation now lets you choose both your Persona and the Place where the scene begins.',
          'Launching a Place selects it automatically, and opening an archived save keeps its saved location selected when available.',
        ],
      },
    ],
  },
  {
    version: '2026.09.28.3',
    publishedAt: '2026-09-28T18:05:00.000Z',
    title: 'A phone layout for Speculus, and deleting a Persona you no longer want',
    sections: [
      {
        id: 'speculus',
        title: 'Speculus',
        items: [
          'Speculus 0.4.2 has a layout built for touch phones, where the screen is split into Main, Setup and Diagnostics tabs. A desktop browser is unchanged, including in a narrow window.',
          'On a phone, Enter starts a new line and the Send button sends your turn, so a multi-line message no longer goes off half-written. A desktop still sends on Enter and uses Shift+Enter for a newline.',
          'A new Back to Orbis button saves your session before it leaves. If that save does not work, it stays where it is and tells you to export instead of losing the session.',
        ],
      },
      {
        id: 'personas',
        title: 'Personas',
        items: [
          'You can now delete a Persona you no longer want, from that Persona\'s own page.',
          'Deleting asks you to confirm first, tells you plainly that it cannot be undone, and returns you to your Persona library once it succeeds.',
          'If a delete does not go through, the page says so instead of letting you believe it worked.',
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
