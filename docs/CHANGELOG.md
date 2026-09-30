# Orbis Changelog

Long-term developer changelog for Orbis, newest first.

This document is **internal**. It records architecture, migrations, importer
behaviour, admin and recovery mechanics, and commit references. It is never
rendered to users. The user-facing changelog is curated separately in
`server/public-changelog.ts` and served at `/changelog`.

## How this document is maintained

- One file, newest entry first. Do not accumulate one-off milestone files; fold
  their durable content into a dated entry here and remove them.
- Each entry states what changed and why, and names the files that carry the
  behaviour.
- Record operational consequences explicitly: new migrations, deployment order,
  new environment variables, and behavioural changes users could notice.
- Never copy private world names, world content, user IDs, Discord IDs,
  credentials, tokens, backups, or server filesystem paths into this document
  either. Refer to them generically.

---

## 2026-09-30 — Discord Coda Kilo context bridge

HW-Coda can now use the server-local Kilo runtime without duplicating Coda's
personality or project grounding. The protected Discord bridge exposes a
machine-only `/context` preparation route that returns the same canonical Coda
prompt used by the existing provider path. It returns no credential or provider
setting.

Discord generation requests now carry guild and channel IDs so HW-Coda can keep
Kilo sessions isolated per channel or DM. Big Brother memories remain excluded
from model context by default; only server, channel, or user-scoped memories
explicitly tagged `coda-context` are eligible. The existing Orbis provider and
all authoritative runtime/write validation remain unchanged and serve as the
fallback path.

### Read-only knowledge and weather capabilities

Coda's provider-independent context preparation now has a constrained
capability gateway. It can search tracked source and documentation in explicitly
allowlisted local Howling Whispers repositories, returning repository, branch,
commit, file and line evidence. Optional remote GitHub search uses fixed GitHub
API endpoints, an organization/repository allowlist and a server-only read token;
it exposes code-search citations and issue/pull-request status but no mutation
operation.

Weather questions use Open-Meteo's fixed geocoding and forecast endpoints. An
explicit place in the message wins; an optional server-configured default is
used only when no place is supplied. Retrieved repository and weather material
is labeled as untrusted data rather than instructions, bounded in size, cached,
and scrubbed for common credential formats before entering model context.

## 2026-09-30 — Coda grounding, Discord reconciliation, provider diagnostics, Praxis teaser

**Public changelog version.** `2026.09.30.2`, titled "A sharper Coda, a tidier
community, and a glimpse of Praxis". The public entry deliberately describes
member-visible outcomes only. Operational details below remain internal.

### Coda grounding and action truthfulness

The Coda Discord bridge and project-insight layer were tightened around a simple
rule: recent conversation is context, not proof of current system state. Project
questions now trigger grounding for more support-shaped topics, including saves,
playthroughs, disabled controls, adult access, mobile behaviour, invite links and
current feature availability. This closes a recurring failure mode where a
recent Discord statement could be repeated as if it described the current code.

Coda's member-safe project knowledge now explicitly describes the existing
private Speculus Save Archive as supporting multiple archived saves while keeping
a richer live playthrough dashboard as a separate future idea. The prompt also
separates ordinary conversation from real action paths: Coda must not claim that
something was filed, checked, sent, linked, invited or passed along unless a
runtime path actually confirms the action. `/coda bug` and `/coda idea` remain
the concrete submission paths.

The same prompt pass clarified the boundary between lawful private adult
roleplay and real-world illegal activity, and demoted Discord transcript context
from authoritative evidence. `friendlyCopy()` was rewritten so provider errors
preserve uncertainty instead of using one failed request to diagnose an entire
account.

### Coda visuals and selective auto-illustration

Coda image generation now starts from a prose-authored canonical visual identity
rather than a fixed img2img pose anchor. Composition variants and anti-repeat
guidance discourage the recurring front-facing, both-paws-raised pose while
keeping the same character identity.

HW-Coda also gained a deliberately narrow spontaneous-illustration path for
strong visual reaction beats. The first rollout is owner-only, probabilistic and
cooldown-limited, and excludes technical, credential, moderation, adult, illegal
activity and other sensitive topics. Image failure is non-fatal and never turns
a successful text response into an error.

### Provider diagnostics without conversation logging

HW-Orbis `9652c83` makes previously opaque Coda provider failures diagnosable.
Empty completions now log structural facts such as model, top-level payload keys
and choices length, and the bridge records non-retryable and exhausted outcomes.
The non-OK provider branch logs status and model only. Raw provider response text
is deliberately excluded because an upstream body can echo prompt or member
conversation content.

This change was promoted from a long-lived server-local debug patch into tracked
source. The production checkout was reconciled to `main`, rebuilt, restarted and
left clean, ending the repeated stash/pull/pop cycle around the bridge file.

### Discord layout reconciliation

The declarative HW-Coda layout had drifted from live Discord in both directions.
The obsolete Archives category had already been intentionally removed live, while
permanent development/team voice rooms existed live but were missing from the
layout. The source was corrected rather than blindly recreating old structure:

- HW-Coda `0bc87db4` narrows the archive rule to preserve useful history, canon,
  development and recovery material without preserving obsolete Discord
  scaffolding for its own sake.
- HW-Coda `0c22266` removes the retired Archives category and archive index from
  the declarative layout.
- HW-Coda `cc096e4` adds the existing Devtalk and Team Chat voice rooms to the
  maintained layout so audit and sync can see them.
- A retired side-project channel declaration was removed from the Coda layout. It
  is no longer part of Howling Whispers, so it is neither declared nor present in
  the maintained layout.

The sync took its normal pre-write guild snapshot. It did not delete undeclared
channels and did not touch the undeclared adult category or the separately
restricted moderation channel.

Two role drifts remained after sync even though their desired values were already
correct in `server-layout.json`: Administrator colour and Member hoist. Root
cause was Discord role hierarchy, not missing Administrator permission. Every
managed target role was above the Coda bot role, making Discord.js
`role.editable` false; `sync()` therefore silently skipped the role edits. The
owner corrected those two presentation properties manually. A final read-only
`/server-audit` returned zero differences: live Discord now matches the reviewed
Coda layout.

**Known Coda manager limitations surfaced by this pass.** `audit()` is currently
one-directional for channels: it reports declared items that are missing or
mismatched but does not report undeclared extras. It also does not verify
permission-overwrite drift on sensitive channels. `sync()` silently skips
existing roles when `role.editable` is false rather than reporting a blocked
change. Future work should add bidirectional channel auditing, permission-drift
checks and explicit `blocked: role_hierarchy` reporting or preflight output.

### Repository/deployment workflow rule

GitHub `main` is the canonical source for tracked code. Production checkouts are
expected to be clean consumers of `main`, not hidden secondary development
branches. Before new code work, intentional tracked server-local edits are
reviewed and either committed/pushed or deliberately removed. Secrets, real
`.env` files, runtime data, logs, backups and build output remain local and out
of Git.

This rule is operational rather than user-visible, but it materially reduces the
risk of editing stale source while production is running untracked behaviour.

### Praxis teaser

The public changelog now hints at **Praxis** without presenting it as shipped.
Praxis remains a separate experimental player-facing project, intentionally kept
apart from Speculus and Fabula while it explores the seam between freeform
narrative and authoritative game state. The changelog wording is explicitly a
teaser, not a release announcement.

No database migration and no new environment variable were introduced by this
pass. Orbis server-side bridge changes require rebuild plus `orbis.service`
restart; Coda layout/configuration changes require a Coda rebuild/restart before
the running process sees the new layout.

---

## 2026-09-28 — Coda consent scoping, account page sections, light mode

**No public changelog entry.** This work is deliberately absent from
`server/public-changelog.ts`. An entry was drafted and withdrawn: it described
account page organisation and light mode appearance, neither of which is part
of the Persona and Speculus phone release the changelog was being written for.
Recorded here only, because the developer changelog does track it.

**Coda shared-key consent, scoped to named accounts.** The shared pool used to
serve any Discord member with no usable key of their own, once the owner ticked
one box. Consent is now per-person: `coda_shared_key_allowed_users`
(migration 025) records the snowflakes an owner names, and `selectPoolMembers`
only matches a requester some eligible owner has actually listed. The master
tick remains but shares with nobody on its own, so an empty list is safe rather
than merely quiet. The stored value is a bare snowflake rather than a user id,
because the person being helped may be a guest who never linked an account.

The account page copy was wrong in two rounds and both were corrected. It first
claimed sharing "spends your own quota", which is false for an unlimited-text
plan; the real consequence is that the owner's account absorbs rate limiting and
provider blocks, which is what `coda-provider-failures.ts` already classifies
and what the per-member cooldown handles. It then still described the retired
blanket behaviour ("for members without a key") in the toggle confirmation. The
copy is now written in Coda's own voice, which is the voice the 503 and the
Discord prompt already use. A false cost warning is worse than no warning,
because it undermines the true ones beside it.

**Account page split into four sections.** Profile, Coda sharing, Preferences
and Your data, as a real tablist with roving tabindex and arrow navigation.
Panels are hidden rather than unmounted, because the credential field is a
controlled input and unmounting would silently discard a half-pasted value.

**Light mode.** Two separate faults. `theme.css` was imported ahead of eight
other stylesheets, so rules such as `.coda-assistant textarea` tied with the
generic light rule on specificity and won on order, leaving dark inputs across
the Coda, record-detail and destructive sheets. Loading the overrides last fixes
that class outright. Separately, roughly forty surfaces authored with hardcoded
dark navy never had a light counterpart; they are now grouped by role. Overlays
are deliberately excluded and a test says so, so a future sweep does not
"fix" the What's New backdrop or the asset-card scrim.

**Tests.** `tests/light-theme-surfaces.test.ts` resolves light values through
the theme and asserts the import order; both were checked to fail when reverted,
because neither CSS nor bundler order fails loudly on its own.

No migration beyond 025, no new environment variable, no deployment ordering
change. `orbis.service` restart is required for all of it, per the existing
deployment note.

---

## 2026-09-28 — Speculus 0.4.2 phone layout and Persona deletion

**Public changelog version.** `2026.09.28.3`. This entry was first published as
`2026.09.28.2` and then renumbered once the copy below was corrected against the
shipped diffs. It is the only public entry for this release, so the superseded
`2026.09.28.2` was removed rather than left to show the same release twice. An
account that acknowledged the withdrawn `2026.09.28.3` is still notified, since
`2026.09.28.3` is newer than it. Commit references belong in this file only:
`tests/changelog.test.ts` fails the build if a hex reference of seven or more
characters appears in the published entry copy.

### HW-Speculus `f8f793a` — phone layout, newline input, version 0.4.2

- Client-side only. No launch package or versioned bridge contract changes, so
  an Orbis side does not need to ship in step.
- `package.json` moves 0.4.1 to 0.4.2.
- The phone layout is gated behind `usePhoneLayout` on
  `(max-width: 780px) and (pointer: coarse), (max-width: 1000px) and
  (max-height: 500px) and (pointer: coarse)`. The `pointer: coarse` arm is what
  keeps desktop unchanged: a narrow desktop window does not pick up the phone
  layout, and desktop keeps Enter-to-send with Shift+Enter for a newline.
- On a phone, Setup and Diagnostics stop being toggled panels and become real
  tabs alongside Main, driven by `data-phone-tab` on the layout rather than by
  unmounting, so switching tabs keeps panel state.
- On a phone, Enter inserts a newline and the existing Send button becomes the
  only way to send. The Send button itself is not new; it already existed.
- New "Back to Orbis" button on the phone tab bar. It calls `saveV2Session` and
  `saveV2LocalAutosave` before navigating, and on a save failure it stays put,
  returns to Main, and reports that the session must be exported instead.
- Worth knowing: that button navigates to a hardcoded
  `https://lib.thehowlingwhispers.com/asset/...` absolute URL rather than a
  configured origin. Fine while the only deployment is production, but it will
  pull a staging or local client across to production. Not changed here.

### HW-Orbis `3a70d86` — Delete Persona from the record page

- `src/views/AssetDetailView.tsx` gains a Delete Persona action, shown when the
  viewer can edit and the record is a Persona.
- Confirmation is `window.confirm` naming the Persona and stating that the
  delete cannot be undone, not a styled dialog. Worth revisiting if the app
  standardises on an in-page confirmation.
- Pending state disables the button and swaps the label to "Deleting...".
  Failures are rendered into a `role="alert"` message rather than swallowed.
- On success it navigates to `/library/persona` with `replace: true`.
- Reuses the existing server-authorized asset deletion endpoint, so no new
  permission and no schema migration are required.
- **Effect on existing saves, now verified rather than assumed.** A save carries
  the Persona as a snapshot inside `payload jsonb`; `speculus_saves` has no
  `persona_id` column, `source_asset_id` carries no foreign key, and the one
  foreign key it does hold, `world_id`, is `ON DELETE SET NULL`. So deleting a
  Persona does not cascade, orphan or blank any save that already exists, and a
  stored save keeps its own title because that is read from
  `save.source.persona?.name` in the payload.
- **The one real consequence is on re-import.** Importing an exported session
  re-resolves `save.source.id` against `library_assets` and answers 409 with
  "The save source record no longer exists in Orbis." A member who deletes a
  Persona and later imports an export launched from it is refused, and must
  relaunch instead. This is a refusal rather than a silent break, and it is the
  behaviour to be aware of when considering a running-simulation check.
- Both facts are pinned by `tests/persona-deletion-save-safety.test.ts` so a
  future migration that adds a persona foreign key with a cascading delete
  fails the build rather than quietly destroying saves.

No migration, no new environment variable, and no deployment ordering change
for either commit.

---

## 2026-09-28 — Changelog system: permanent page plus account-backed notice

**Problem.** Release notes lived only in a one-off milestone document written
for internal review. There was no permanent place to read what changed, and no
way to tell a returning member that something had changed since their last
visit. A purely local "seen" flag was the obvious shortcut and was rejected:
it cannot survive a new device, a cleared browser, or a second account, and it
turns a release note into a mutable client-side guess about server state.

**Solution.** Two surfaces, one curated source.

- `server/public-changelog.ts` — the hand-curated public source of truth. It is
  never rendered from `docs/CHANGELOG.md`, and the two files are deliberately
  different documents: this one records internals, the other records
  user-visible outcomes only. It also owns version comparison
  (`compareChangelogVersions`, `unreadChangelogEntries`) so ordering logic
  exists once, on the server.
- `server/changelog.ts` — `GET /` is public and never fails for any reason a
  member could cause; `GET`/`PUT /acknowledgement` require a session. The
  router degrades to `unreadVersions: null` when the acknowledgement table is
  absent, and answers `503` on write, so a rolling deploy that has not yet run
  migration `023` cannot take the changelog down. Acknowledgement refuses an
  unpublished version and never moves the marker backwards.
- `server/migrations/023_user_changelog_state.sql` — `user_changelog_state`,
  keyed by `user_id`. Apply with `psql -f` in numeric order; Orbis has no
  migration runner.
- `src/views/ChangelogView.tsx` and `src/components/WhatsNewDialog.tsx` — the
  permanent `/changelog` page (public, SEO-aware) and the notice (signed-in
  members only). The notice traps focus, restores it on close, scrolls only its
  body, and offers `ROGER` to acknowledge or close with no commitment.
- `src/hooks/useWhatsNew.ts` — visibility logic. It is silent on every failure
  path: a fetch error, an acknowledgement write error, or a signed-out visitor
  each mean the notice simply does not appear. The changelog can never block
  Orbis from loading.

**Versions.** Monotonic `YYYY.MM.DD.N`, compared numerically on the server.
The displayed date is for humans only and is never parsed to decide
acknowledgement.

**Sanitization.** Public copy is written to a need-to-know standard: no private
world names or content, no user or Discord identifiers, no database or
connection details, no credentials, no server paths, no backup or migration
internals, and no mention of administrative, recovery, or repair capabilities.
`tests/changelog.test.ts` gates the published copy against those patterns, so a
future entry cannot quietly leak them.

---

## 2026-09-28 — Version 0.3.0

### Canonical Places: one authoritative record per Place

**Problem.** World Forge, Coda, importers and Speculus all treated the world
root document's embedded `locations` array and the canonical `library_assets`
Place rows as competing sources of truth. A world save carried whatever the
editor last loaded, which is routinely older than a canonical Place edited
elsewhere, so a root save could overwrite or delete newer canonical Places.

**Solution.** Canonical `library_assets` rows linked by `origin_world_id` are
authoritative for Places. The embedded array is a compatibility projection.

- `server/world-children.ts` — the single entry point for world children. It
  adds no new write SQL; it composes `insertAsset`, `applyAssetUpdate` and
  `removeCanonicalChildFromWorldProjection`, so every caller inherits the same
  ownership, transaction, revision and projection behaviour. Place parent
  validation (missing, ambiguous, cross-world, non-Place, self, cycle) runs
  inside the write transaction, so there is no check-then-write gap.
- `mergeChildDocumentPatch` — recursive document merge, so a partial patch
  naming one nested key cannot erase its authored siblings.
- `createImportedWorldChild` — provenance-preserving child creation for
  importers, inside the caller's transaction. Refuses an orphan child, is a
  no-op on re-run, and cannot overwrite newer authored state.

**Root save boundary.** `server/asset-writes.ts` treats `locations` as a
root-owned collection. Three parts are required, not one:

1. The submitted array is discarded and the stored projection restored *before*
   change detection, inferred removal, the world write and the projection
   rebuild.
2. `locations` is excluded from embedded-to-canonical synchronization, so a
   stale array cannot overwrite a canonical row even when the *stored*
   projection has drifted. Preserving the array alone was insufficient.
3. `rebuildWorldProjection` gained `preserveUnlinkedKeys`, so the rebuild keeps
   legacy embedded entries that have no canonical row. Without this, the guard
   would have deleted authored world data.

The other five collections (species, factions, societies, families, memories)
remain root-authored and were deliberately not migrated.

**Routes.**

- `GET /v1/library/assets/:worldId/children` — grouped read, sourced only from
  `origin_world_id`, ordered by `created_at, id`. Never hydrates from the world
  document. Applies normal direct world privacy and adult-content access.
- `POST /v1/library/assets/:worldId/children`
- `PATCH /v1/library/assets/:worldId/children/:childId`
- `PUT /v1/library/assets/:worldId/children/:childId/parent`
- `DELETE /v1/library/assets/:worldId/children/:childId`

**World Forge.** `src/components/WorldForgeEditor.tsx` reads Places from the
grouped endpoint and writes through the canonical endpoints, reloading
canonical state after every successful mutation. The root save payload omits
`document.locations` entirely. The Places UI is otherwise unchanged. Place
documents keep both `id` and `worldEntryId`, because the Speculus packaging
layer falls back to `document.id` for source identity.

**Coda.** `create-place` routes through `createWorldChild`; `update-place` and
`move-place` route through `patchWorldChild`. A Coda operation may no longer
replace a world's `locations`; it is refused with
`embedded_locations_forbidden` before any write. Policy refusals report as
`rejected` while ordinary write failures still report as `failed`, preserving
the existing batch-isolation semantics. `CodaFileAssistant` "Add one place" now
creates a canonical child rather than appending to the world document.

**Importers.** `import-place-bundle.ts` creates children through
`createImportedWorldChild`, keeping its own outer transaction and stable source
IDs.

**Persona selection.** `POST /v1/library/assets/:id/simulate` now requires
`{ personaId }`. `GET /v1/library/simulation-personas` lists only Personas the
caller may ordinarily use: owned, or directly visible with `allowUse`. Target
access and Persona access are validated independently; super-admin recovery
stays an explicit route-level bypass and is never presented as ordinary
`allowUse` permission. The package carries the selected canonical Persona ID,
name, a structured core `document` and a compatibility `description`. The
previous active-user placeholder is gone. Persona remains excluded from
launchable target types. Speculus accepts the structured core with a `{}`
default so older launch packages still validate.

### Known limitations carried by this release

- Archive, world-backup and Bitterroot importers still write child rows with
  their own SQL. They additionally restore archived asset IDs, timestamps and
  Speculus registry identities that the shared child service does not model.
  They do call the shared projection layer, so canonical linkage and
  transactionality are unchanged. Converting them is the next import step.
- World *creation* may still accept embedded Places and promote them to
  canonical rows. Only updates are protected.
- Excluding Places from root synchronization means a later world content-rating
  change no longer propagates to Place rows through the sync path. Explicit
  rating propagation was not implemented.
- Place deletion keeps existing dependency protection: deleting a Place that
  has children is refused rather than reparenting them, because client-side
  reparenting followed by delete would not be atomic.
- Legacy embedded Places with no canonical row survive root saves but do not
  appear in the canonical-only Places list. The integrity checker reports them.
- Coda has no delete operation. Adding one is deferred rather than routed
  unsafely.
- Coda updates for non-Place types still use replacement document semantics.
  That is pre-existing behaviour, unchanged here.

### Validation

- Orbis: 46 test files, 288 passed, 8 skipped (previous baseline 41 / 255).
- Orbis `npm run lint` and `npm run build` clean.
- Speculus: 24 test files, 125 passed; lint clean.
- The integrity CLI was **not** run against a real database for this release:
  no `DATABASE_URL` was available in the build environment and the command
  refuses to guess one. Run `npm run check:world-integrity` before deploying.

---

## 2026-09-27 — Version 0.2.0

### World document boundary and importer hardening

- Malformed world collections are rejected at the write boundary rather than
  silently coerced to empty arrays, which previously made a broken collection
  indistinguishable from an empty one.
- Importers became transactional and stopped performing destructive
  world-document upserts.
- Private world payloads, dumps and backups are refused in Git.

---

## 2026-09-26 — Version 0.2.0

### Record artwork

- Cover and gallery artwork for every record type. Binary image data never
  enters PostgreSQL; files live on disk outside the repository and are served
  only through an access-checked route.
- Migration `022_asset_images.sql` creates `library_asset_images` and
  `admin_view_preferences`. Orbis has no migration runner: every migration is
  applied by hand with `psql -f`, in numeric order.

---

## 2026-09-08 — Version 0.1.0

### Initial public release

- Orbis as the canonical library: assets, worlds, ownership, privacy, account
  settings, imports and exports, and Speculus launch authority.
- Persona assets introduced by migration `021_persona_assets.sql`.
- Asset revision history (`017_asset_revisions.sql`) covering editor, Coda,
  import and system sources.
