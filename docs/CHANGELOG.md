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
