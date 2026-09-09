# Orbis

Orbis is the current standalone reusable asset archive and world-authoring application for The Howling Whispers.

This repository is the canonical home for Orbis. Historical Library and Rebrand-era material does not override the code or documentation on `HowlingWhispers/HW-Orbis` `main`.

## Current direction

- Server-backed assets and ownership
- Reusable Characters, Places, Items, Factions, Species, Societies, Families, Memories, and Worlds
- World Forge authoring and editing
- Discord authentication, ownership, privacy, and verified-access controls
- Protected administration and PostgreSQL-backed operational settings
- Orbis-owned provider credentials and short-lived grants for Speculus
- Import/export support for authored worlds and assets

## Project boundaries

- **Orbis** owns the asset library, world authoring, ownership, privacy, account-facing settings, and launch authority.
- **Speculus** owns simulation/runtime behavior after an Orbis launch package is issued.
- **Fabula** is the home for Fabula-specific future gameplay/world-system design and implementation.
- **Studium** and **Mens** currently exist as separate placeholder repositories and must not be treated as implemented Orbis modules unless their repositories define that work.
- **HW-Library** is a historical predecessor. New Orbis work belongs here, not there.
- Rebrand material may be used as historical/import source data, but Rebrand is not the current implementation target.

See [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md), [`docs/REPOSITORY_MAP.md`](docs/REPOSITORY_MAP.md), and [`docs/PROJECT_BOUNDARIES.md`](docs/PROJECT_BOUNDARIES.md) before starting cross-project work.

## Branch model

- `main` is the canonical current branch.
- Temporary feature branches may exist while work is being reviewed, but they are not authoritative until merged.
- Do not infer permanent branch roles from historical branch names or old documentation.

No formal release versioning or changelog is required during the current core-development stage.

## Local development

Requirements: Node.js 20 or newer and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

The development server opens on `http://localhost:5174`.

Set `VITE_ORBIS_API_URL` to the API base when using the server-backed frontend. `VITE_HW_LIBRARY_API_URL` remains a compatibility fallback. Leave both blank only for local fixture development. Run `npm run dev:api` separately when developing the PostgreSQL-backed API and administration area.

## Verification

```bash
npm test
npm run build
npm run preview
```

The production preview opens on `http://localhost:4174`.

## Source structure

- `src/api` contains the Orbis client boundary and HTTP/fixture implementations.
- `src/components` contains shared shell, editors, cards, and state primitives.
- `src/features/library` contains temporary frontend fixtures used only for development.
- `src/views` contains Orbis home, collections, record details, editors, account, and administration views.
- `src/types` contains shared asset and launch contracts.
- `server` contains Discord OAuth, access policy, settings, audit, Orbis Library endpoints, and Speculus integration.
- `server/data/bitterroot.json` contains the current Bitterroot seed/import snapshot.
- `docs/platform` contains Orbis platform documentation.
- `docs/legal` contains legal and policy documents.

## Bitterroot import

The current server includes the canonical Bitterroot import path. Existing imported records are server-backed and owned by their assigned Orbis user. Treat Rebrand references in the import history as provenance, not as a current development repository.
