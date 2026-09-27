# Canonical World Forge Places Milestone Changelog

## Scope

This log tracks the first canonical World Forge delivery only:

- shared canonical world-child service and read API
- World Forge Places canonical reads and writes
- Coda and importer Place operations using the shared write layer
- Persona selection for Speculus launches
- compatibility projections retained where required

Species, factions, societies, families, and memories remain outside this milestone.

## Baseline

- Branch: `main`
- Starting commit: `d45a6c7`
- Working tree: clean
- Tests: 41 files passed, 255 active tests passed, 8 skipped
- Type-check/lint: passed
- Production build: passed with the existing Vite chunk-size warning
- Integrity CLI: unavailable because this workspace exposes no `DATABASE_URL`; the command refused safely

## Architecture Decisions

- Canonical `library_assets` children linked by `origin_world_id` are authoritative.
- Embedded world child arrays remain compatibility projections only.
- Root-world updates must not overwrite newer canonical Places from stale `document.locations` input.
- World Forge, Coda, and importers must reuse the same canonical service and existing asset write primitives.
- Speculus launch requires an explicit canonical Persona ID; target and Persona authorization are independent.
- Persona core data remains immutable launch context. Per-save runtime state remains outside the Persona asset.

## Delivered

### Shared canonical world-child service

`server/world-children.ts` is the one canonical entry point for world children. It
adds no new SQL write path; it composes the existing `insertAsset` /
`applyAssetUpdate` / `removeCanonicalChildFromWorldProjection` primitives so
every caller inherits the same ownership, transaction, revision and projection
behavior.

- `listWorldChildren` — grouped read straight from `origin_world_id`, ordered by
  `created_at, id`. Never reads the world document.
- `createWorldChild`, `updateWorldChild`, `patchWorldChild`, `moveWorldChild`,
  `deleteWorldChild` — all reuse the shared asset writers.
- `validatePlaceParent` — rejects a missing, ambiguous, cross-world, non-Place
  or self-referential parent, and refuses a change that would create a cycle.
  Runs inside the write transaction, so there is no check-then-write gap.
- `mergeChildDocumentPatch` — recursive merge, so a partial patch naming one
  nested key cannot erase its authored siblings.
- `createImportedWorldChild` — provenance-preserving child creation for
  importers, inside the caller's transaction.

`server/library.ts` exposes it over the Library boundary:

- `GET /v1/library/assets/:worldId/children`
- `POST /v1/library/assets/:worldId/children`
- `PATCH /v1/library/assets/:worldId/children/:childId`
- `PUT /v1/library/assets/:worldId/children/:childId/parent`
- `DELETE /v1/library/assets/:worldId/children/:childId`

The grouped read applies normal direct world privacy and adult-content access.

### Root save can no longer author Places

`server/asset-writes.ts` now treats `locations` as a root-owned collection:

- the submitted array is discarded and the stored projection restored *before*
  change detection, inferred removal, the world write and the projection
  rebuild;
- `locations` is excluded from embedded-to-canonical synchronization, so a stale
  array cannot update or create a canonical Place even when the stored
  projection has drifted;
- the projection rebuild preserves unlinked legacy `locations` entries instead
  of dropping them, so a root save never deletes authored world data.

The other five collections are untouched and still root-authored.

### World Forge Places

`src/components/WorldForgeEditor.tsx` reads Places from `listWorldChildren` and
writes through the canonical endpoints, reloading canonical state after every
successful mutation. The root save payload omits `document.locations` entirely.
Canonical Places still feed the hierarchy, the society/memory selectors and the
context preview. The Places UI is otherwise unchanged.

Place documents keep both `id` and `worldEntryId`, because the Speculus
packaging layer falls back to `document.id` for source identity.

### Coda

- `create-place` routes through `createWorldChild`; `update-place` and
  `move-place` route through `patchWorldChild`, so all of them share parent and
  cycle validation.
- A Coda operation may no longer replace a world's `locations`; it is refused
  with `embedded_locations_forbidden` before any write.
- Policy refusals report as `rejected`, ordinary write failures still report as
  `failed`, so batch isolation semantics are unchanged.
- `CodaFileAssistant` "Add one place" creates a canonical child instead of
  appending to the world document. It states plainly that undo is unavailable
  for a new Place rather than pretending otherwise.

Coda has no delete operation; adding one is deferred rather than routed
unsafely.

### Importers

`import-place-bundle.ts` now creates children through
`createImportedWorldChild`, keeping its own outer transaction and its stable
source IDs. The primitive refuses an orphan child, is a no-op on re-run, and
cannot overwrite newer authored state.

### Persona and Speculus

- `POST /v1/library/assets/:id/simulate` requires `{ personaId }`.
- `GET /v1/library/simulation-personas` lists only Personas the caller may
  ordinarily use: owned, or directly visible with `allowUse`.
- Target access and Persona access are validated independently. Super-admin
  recovery stays an explicit route-level bypass and never appears as ordinary
  `allowUse` permission.
- The package carries the selected canonical Persona ID, name, a structured
  core `document` and a compatibility `description`. The active-user placeholder
  is gone. `personaSettings` and runtime state are excluded.
- Persona remains excluded from launchable target types.
- Speculus accepts the structured Persona core with a `{}` default, so older
  launch packages still validate.

## Validation

- Orbis tests: 46 files passed, 288 passed, 8 skipped (baseline 41 / 255).
- Orbis `npm run lint`: passed.
- Orbis `VITE_ORBIS_API_URL=/api npm run build`: passed.
- Speculus tests: 24 files passed, 125 passed.
- Speculus `npm run lint`: passed.
- `git diff --check`: clean.
- Integrity CLI: **not run against a real database.** This workspace exposes no
  `DATABASE_URL`; `.env.production` contains only browser build variables. The
  command refused rather than guessing a database. The 0-errors/0-warnings
  assertion for real imports is inside the DB-gated skipped set, so it is
  verified by the shared code path in tests but not against live data.

## Known Remaining Paths

Still treating `document.locations` as authoritative or as input:

- **Browser world-JSON import** still accepts embedded Places as import input.
  It routes them through the canonical create transaction, so the result is
  canonical, but the input shape is still the embedded array.
- **Archive, world-backup and Bitterroot importers** still write child rows with
  their own SQL. They additionally restore archived asset IDs, timestamps and
  Speculus registry identities, which the shared child service does not model.
  They do call the shared projection layer, so canonical linkage and
  transactionality are unchanged. Converting them is the next import step.
- **World creation** may still accept embedded Places and promote them to
  canonical rows. Only *updates* are protected.
- **Migration and repair utilities** intentionally read embedded Places as
  legacy input or projection state; they are not authoring paths.
- **Other collections** (species, factions, societies, families, memories) are
  still root-authored in both the editor and the write path, deliberately.
- **Coda updates for non-Place types** still use replacement document
  semantics. That is pre-existing behavior, unchanged here.
- **Content rating propagation**: excluding Places from root synchronization
  means a later world rating change no longer propagates to Place rows through
  the sync path. Places have not been given an explicit rating propagation.
- **Place deletion** keeps the existing dependency protection. Deleting a Place
  with children is refused rather than reparenting them, because client-side
  reparenting plus delete would not be atomic.
- **Legacy embedded Places with no canonical row** survive root saves but do not
  appear in the canonical-only Places list. The integrity checker reports them.
