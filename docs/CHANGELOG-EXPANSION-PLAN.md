# Larger Orbis Changelog — Plan

## Current state (verified)

Two surfaces, two stores, deliberately minimal:

- **Public content** — `server/public-changelog.ts`, 376 lines, 8 hand-curated entries
  (`2026.10.01.1` newest). In-memory array, no database dependency.
- **Per-account state** — `user_changelog_state` (migration `023`), one column
  (`acknowledged_version`) plus a monotonic marker. No RLS. Cascades on user delete.

Routes (mounted `server/index.ts:157`, **no auth middleware**):
- `GET  /api/v1/changelog` — public, never errors; `unreadVersions: null` on any DB trouble
- `GET  /api/v1/changelog/acknowledgement` — session required
- `PUT  /api/v1/changelog/acknowledgement` — session required, monotonic, validates
  the version is published

Frontend: `/changelog` page (`ChangelogView.tsx`, 60 lines), `WhatsNewDialog.tsx` (166
lines), `useWhatsNew.ts` (44 lines), auto-opens for signed-in accounts with unread entries,
`src/styles/changelog.css`.

Gates: `tests/changelog.test.ts` scans the **source text** of `public-changelog.ts` for
forbidden patterns (UUIDs, connection strings, server paths, secrets, super-admin, recovery
mechanics, migration internals, commit hashes, private world names, developer column names)
plus per-entry structural rules (section ids `^[a-z0-9-]+$`, every item ends with a period,
no empty sections).

Constraints from `AGENTS.md`: migrations applied by hand with `psql -f` in numeric order, no
runner; DB config in `/etc/howling-whispers/orbis.env`; must run `npm test`, `npm run lint`,
`npm run build`; build `dist-server/` **then restart `orbis.service`** or the old code keeps
answering.

---

## What "larger" has to survive

At 8 entries this is a hand-curated list. The failure modes appear well before "large":

1. **Version collision.** `YYYY.MM.DD.N` is manual. Two same-day releases collide, and the
   monotonic acknowledgement silently drops one.
2. **The unread backlog.** A member away for six weeks returns to a dialog stacking every
   missed entry. `useWhatsNew` opens on *any* unread, so the popup grows without bound.
3. **One monolithic source file.** The sanitizer reads raw source text. It is a reasonable
   gate at 376 lines and an unmaintainable one at 2,000.
4. **Every entry is one shape.** `sections[].items[]` (flat strings) cannot express a
   before/after, a link to the thing, or a "read more" that is not a wall of text.
5. **Nothing is draftable.** Publishing is editing source and deploying. There is no preview,
   no scheduled publish, no rollback without a revert commit.
6. **No per-entry granularity in state.** One account-wide marker means a member cannot
   dismiss one entry and keep others, and there is no way to ask "who has read what."

---

## Recommended direction

Split the problem: **keep content authored in source, move identity/ordering/state into the
database, and add a digest layer.**

This preserves the property the file header cares most about — *a database outage cannot hide
the changelog* — while fixing everything that actually breaks at scale.

### Phase 1 — Unread backlog and collision safety (no schema change)

Cheapest, highest value, reversible.

- **Cap the popup.** Show at most the newest 3 unread in the dialog, with "and N earlier
  updates — see the full changelog". Never auto-open on a backlog beyond a threshold.
- **Digest mode.** When `unreadVersions.length > 3`, render one rolled-up digest instead of
  stacked entries, so returning members get one readable panel rather than ten.
- **Version uniqueness test.** Assert `publicChangelogEntries` versions are unique and
  strictly descending. Cheap, and catches the collision before deploy.
- **Reminder that acknowledgement is not a receipt.** `docs/CHANGELOG.md` can note that
  bumping a version re-notifies everyone, so batch same-day releases.

### Phase 2 — Content authoring (source stays source)

Split `public-changelog.ts` into `server/changelog/entries/<version>.ts`, one entry per file,
with an index that imports and sorts them. Keep entries in source deliberately: sanitization
is a **text** gate, code review is the authoring workflow, and no DB is needed to serve the
changelog.

- Extract the forbidden-pattern rules into one shared module used by the test *and* available
  to a dev-time lint command (`npm run changelog:check`), so authors get the gate without
  running the suite.
- Extend `PublicChangelogEntry` additively with optional fields so old entries stay valid:
  - `summary?: string` — one line for the digest and the dialog header
  - `highlights?: Array<{ text: string; kind: 'new' | 'improved' | 'fixed' }>` — scan-friendly
    flags for the digest
  - `links?: Array<{ label: string; href: string }>` — internal Orbis routes only
  - `audience?: 'everyone' | 'creators'` — lets operator-only notes be filtered out
- Keep every new field optional so the 8 existing entries need no rewrite.

### Phase 3 — Per-entry acknowledgement (new migration `029`)

Replace the single marker with per-entry state so a member can dismiss one update and keep
others.

```sql
CREATE TABLE IF NOT EXISTS user_changelog_reads (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);
CREATE INDEX IF NOT EXISTS user_changelog_reads_recent_idx
  ON user_changelog_reads (user_id, read_at DESC);
```

- `user_changelog_state` stays as a high-water mark; the two-table design means unread
  computation is `published versions > high-water mark OR not present in reads`, which is
  index-friendly and degrades to today's behavior if the new table is missing.
- `PUT /acknowledgement` accepts `{ version }` or `{ versions: [...] }`; bulk acknowledge
  writes rows and advances the high-water mark in one transaction.
- `GET` returns both `unreadVersions` (unchanged contract) and a richer `unread` array with
  `summary`/`highlights`, so the client can render a digest without a second fetch.
- All reads keep the current graceful-degradation contract: any DB failure yields
  `unreadVersions: null`, never a 500.

### Phase 4 — Scale and operations

- **Paginate** `GET /api/v1/changelog` with `?before=<version>&limit=` (default 20) for the
  `/changelog` page; keep the unpaginated shape for the dialog, which only needs recent
  entries.
- **Draft + preview.** A `/admin/changelog` view renders a candidate entry through the same
  sanitization module before it is committed. Publishing stays a source commit — no runtime
  write path — so there is no new privileged surface and the text gate cannot be bypassed.
- **Scheduled publish** only if it earns its keep; the `YYYY.MM.DD.N` scheme and the text
  gate both assume committed content.

---

## Sequencing and risk

| Phase | Schema | User-visible | Reversible by |
|---|---|---|---|
| 1 Unread digest | none | yes, popup stops being overwhelming | revert one commit |
| 2 Authoring split | none | no | revert one commit |
| 3 Per-entry reads | `029` | yes, finer dismissal | drop new table, high-water mark still works |
| 4 Pagination/preview | `029` + optional | yes | feature flag |

Do **1** before anything else: it is the failure users actually notice, it needs no
migration, and it does not touch the contract that keeps the changelog from blocking app
entry.

Do **not** make published entries database-backed. It would put the changelog on the same
failure path as the Library itself, which is the one thing `public-changelog.ts`'s header
explicitly exists to prevent.

## Definition of done for any phase

- `npm test`, `npm run lint`, `npm run build` clean with `VITE_ORBIS_API_URL` set
- `npm run changelog:check` passes for new copy
- `dist-server/` built **and `orbis.service` restarted**, then endpoints verified directly
- New changelog copy still passes every `tests/changelog.test.ts` sanitization gate
- No regression in the "database outage must not hide or break the changelog" behavior —
  that one has explicit tests and must keep passing