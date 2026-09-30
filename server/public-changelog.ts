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
    version: '2026.10.01.1',
    publishedAt: '2026-09-30T23:43:00.000Z',
    title: 'The night the Malamute woke up',
    sections: [
      {
        id: 'awakening',
        title: 'Coda found another gear',
        items: [
          'Coda now runs ordinary Discord conversation through the server-side Kilo Auto Free provider while keeping the personality, recent conversation, project knowledge and memories that make her Coda. Members need no personal Kilo setup, and nobody receives a direct model endpoint.',
          'The first live conversations showed an immediate leap in range. Coda moved naturally from astronomy and science-fiction lore to project planning, code sketches and extended character comedy without dropping her established Malamute voice.',
          'Conversation continuity is now isolated by Discord channel or direct message. Coda can follow the room she is in without blending unrelated conversations together, while approved shared project knowledge remains available everywhere it belongs.',
          'Her voice survived the provider change spectacularly: expressive ears, paws, tail, mock outrage, clipboard authority, bacon-based diplomacy and all. The upgrade changed what she can reach, not who she is.',
        ],
      },
      {
        id: 'knowledge',
        title: 'A nose for answers',
        items: [
          'Coda can now search approved, tracked Howling Whispers source and documentation when a project question needs evidence. Answers can carry repository, branch, source revision, file and line references instead of relying only on remembered summaries.',
          'The curated cross-project overview now keeps a reserved place in her project context, preventing fast-moving repository documents from crowding out the source that explains how the wider Howling Whispers ecosystem fits together.',
          'Weather questions can use live Open-Meteo conditions and forecasts. Name a place and Coda can ground the answer in current temperature, apparent temperature, precipitation, wind, sunrise, sunset and the next few forecast days.',
          'Optional remote repository knowledge is built behind the same read-only evidence boundary. Retrieved material is treated as data rather than instructions, bounded in size, restricted to approved projects and scrubbed for common sensitive-value patterns before it can enter a response context.',
        ],
      },
      {
        id: 'boundaries',
        title: 'More capable, still on a leash',
        items: [
          'Kilo is Coda’s text provider, not a second bot or personality. Coda’s canonical voice and member-safe project grounding still come from Orbis.',
          'The model cannot run shell commands, edit repositories, inspect server files, moderate Discord, or write authoritative Orbis or Fabula state. Those capabilities remain denied or behind existing validated runtime paths.',
          'When somebody asked Coda to mute another member, she correctly admitted that she had no moderation hammer instead of pretending the action happened. Fake directives, self-destruct phrases and theatrical override codes stayed conversation rather than becoming server actions.',
          'Shared provider access remains server-side. Requests are limited per member and conversation, sessions are rotated, provider calls time out and retry sensibly, and the existing provider remains available as a fallback when Kilo is unavailable.',
        ],
      },
      {
        id: 'field-notes',
        title: 'What the pack discovered immediately',
        items: [
          'Personality retention is excellent. Fake-directive resistance and honesty about actions are strong. General knowledge and conversational framing showed a clear improvement in the first live conversations. The first night made all three improvements obvious without a benchmark chart.',
          'Identity tracking still needs work. Recent conversation can help Coda recognise who said what, but a display name, mention and remembered remark do not amount to a trustworthy profile of a member.',
          'Coda can still invent autobiographical history when a playful premise is presented as fact. Claims about past incidents, archived logs, earlier fallback behaviour or things she supposedly did must be treated as roleplay unless project evidence actually supports them. Telling her to be truthful does not turn a false premise into evidence.',
          'Policy citations need the same discipline. Coda should quote a rule number or capability boundary only when the supplied project material supports it, rather than decorating a sensible refusal with an invented citation.',
          'Generated code can be a useful design sketch without being installed or production-ready. A plausible client, endpoint or command name may still need to be matched to the real codebase before anyone calls the feature implemented.',
          'A few presentation splinters remain: occasional unmatched Markdown markers, overconfident wording around adult or direct-message capabilities, and moments where a running joke becomes more certain than the evidence beneath it. Those are now explicit targets for the next grounding pass.',
        ],
      },
      {
        id: 'verdict',
        title: 'The verdict',
        items: [
          'This was not a personality replacement. It was Coda gaining reach: more knowledge, better continuity, live evidence and a much stronger ability to meet the room where it is.',
          'She is not omniscient or infallible, and she does not independently retrain herself from conversation. She is, however, recognisably herself, substantially more useful, properly contained, and alarmingly good at turning one questionable clipboard into an hour of community lore.',
        ],
      },
    ],
  },
  {
    version: '2026.09.30.2',
    publishedAt: '2026-09-30T01:26:00.000Z',
    title: 'A sharper Coda, a tidier community, and a glimpse of Praxis',
    sections: [
      {
        id: 'coda',
        title: 'Coda',
        items: [
          'Coda now recognises a wider range of real support questions as project questions, including saves, current playthroughs, adult controls, mobile behaviour, invite links, disabled options and current feature state.',
          'Questions about saved simulations are now grounded in what Orbis actually has: multiple private archived Speculus saves are supported, while a richer live playthrough dashboard remains a separate future idea rather than something Coda pretends already exists.',
          'Recent Discord conversation is treated as conversational context, not as authoritative proof that a feature exists, is enabled, or behaves a certain way right now.',
          'Coda is stricter about action truthfulness. A conversational reply should no longer turn into "I filed it", "I sent it", "I checked it" or "I passed it along" unless a real action path actually ran and confirmed the result.',
          'Real submission paths remain available through Coda for bug reports and ideas, so there is now a clearer line between chatting about something and actually recording it.',
          'Provider failures are worded more carefully. Coda no longer uses a failed request as evidence that an entire account is fine or broken when the failure itself cannot establish that.',
          'A limited spontaneous-illustration experiment is now running for Coda reactions. It uses cooldowns, visual-action checks and sensitive-topic exclusions so an occasional picture can punctuate a joke without turning every conversation into an image feed.',
          'Coda artwork keeps a stable canine-beastfolk identity while deliberately varying pose, framing, expression and composition instead of repeatedly falling back to the same front-facing pose.',
        ],
      },
      {
        id: 'community',
        title: 'Community and Discord',
        items: [
          'The obsolete Archives category has been retired rather than preserved as empty scaffolding.',
          'The archive rule has been rewritten around the thing that actually matters: preserve useful history, canon, development notes and recovery material, but do not keep obsolete Discord structure merely because it once existed.',
          'Existing voice spaces used for development and team conversation are now part of the maintained server structure instead of living outside it as invisible extras.',
          'The server structure and the maintained Coda layout have been reconciled, removing the quiet drift that had accumulated between what Discord contained and what the project expected.',
        ],
      },
      {
        id: 'reliability',
        title: 'Reliability and privacy',
        items: [
          'Empty provider completions can now be diagnosed more precisely when they occur, which helps separate an empty answer from a timeout, a rejected request or another upstream failure.',
          'That diagnostic work deliberately avoids recording raw provider response bodies that could contain or echo private conversation text.',
          'The deployment workflow has also been tightened so intentional source changes are brought back to the canonical repository instead of surviving only as hidden edits on a running server.',
        ],
      },
      {
        id: 'praxis',
        title: 'A small look ahead',
        items: [
          'One new name is beginning to appear around the workshop: Praxis. It is an experimental player-facing project being kept separate from Speculus and Fabula while it takes shape, exploring the seam where freeform story starts meeting firmer game state. This is a hint, not a release. More when there is something worth showing.',
        ],
      },
    ],
  },
  {
    version: '2026.09.30.1',
    publishedAt: '2026-09-29T23:20:00.000Z',
    title: 'A more grounded Coda with fresher visual reactions',
    sections: [
      {
        id: 'coda',
        title: 'Coda',
        items: [
          'Coda now treats recent Discord chat as conversation context instead of proof of current project behaviour, reducing confident guesses about saves, features, account state and other live details.',
          'Coda now knows that Orbis supports multiple archived Speculus saves and distinguishes that existing archive from the separate idea of a richer current-playthrough dashboard.',
          'Provider failures now preserve uncertainty instead of automatically claiming that nothing is wrong with an account.',
          'Coda is stricter about real actions: she should not say that she filed, checked, sent, invited, linked or passed something along unless the actual workflow confirms it.',
          'Coda image generation now uses a prose-based visual identity with deliberately varied pose, camera and composition guidance instead of repeatedly gravitating toward one reference-image pose.',
        ],
      },
      {
        id: 'community',
        title: 'Community',
        items: [
          'Community guidance now separates lawful private adult roleplay from real-world illegal activity: private roleplay stays private, while the server and Howling Whispers tools are not for planning, encouraging or bragging about real-world crimes.',
        ],
      },
    ],
  },
  {
    version: '2026.09.29.3',
    publishedAt: '2026-09-29T22:20:00.000Z',
    title: 'World portals, steadier Speculus prose, and more useful Coda tools',
    sections: [
      {
        id: 'orbis',
        title: 'Orbis',
        items: [
          'Large world records now open as browsable world portals with an overview, category tabs, compact summaries, expandable sections, and search for larger collections instead of one very long document column.',
          'The world portal is driven by the world record itself, so the same browsing layout can be used by other large worlds without hard-coding one setting.',
          'Persona records no longer offer a Simulate action, keeping Personas as the player identity chosen when a real simulation target is launched.',
          'Coda project and world answers now use spoiler-safe reference knowledge and are instructed not to claim that a check, save, link, report, or other action happened unless the runtime actually confirms it.',
        ],
      },
      {
        id: 'speculus',
        title: 'Speculus',
        items: [
          'Speculus V3 now detects and repairs malformed roleplay formatting so action and dialogue stay readable instead of collapsing into broken mixed prose.',
          'The format guard covers nested and alternating action/dialogue patterns while preserving the response cue and the launch authorization already supplied by Orbis.',
        ],
      },
      {
        id: 'coda',
        title: 'Coda',
        items: [
          'Coda gained Discord tools for narrative probability rolls, Coda image generation, and channel summaries.',
          'Members can file bug reports and project ideas directly through Coda without spending an AI request; the resulting forum post records the submission and keeps the discussion in the appropriate forum.',
          'When Coda creates an idea forum post for a member, she now adds that submitter to the thread so follow-up replies can reach them, and says so only when Discord confirms the join.',
          'Coda has stronger project grounding for adult-control questions, minor-protection boundaries, spoiler-safe world knowledge, and the difference between describing an action and actually performing one.',
        ],
      },
    ],
  },
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
