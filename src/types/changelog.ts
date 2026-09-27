/**
 * Public changelog contract shared with the browser.
 *
 * Mirrors the shape served by `server/public-changelog.ts`. The version
 * comparison itself is deliberately *not* mirrored: the server decides which
 * entries are unread so there is one authority for ordering.
 */
export type PublicChangelogSection = {
  id: string;
  title: string;
  items: string[];
};

export type PublicChangelogEntry = {
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
   * when there is no signed-in account, or when acknowledgement could not be
   * read — in both cases the UI skips the automatic notice rather than guessing.
   */
  unreadVersions: string[] | null;
};
