# Orbis

Orbis is the standalone reusable asset archive for The Howling Whispers.

The `HW-Orbis` repository contains the user-facing Orbis frontend and its Library-specific API client. It is intentionally separate from Rebrand (`HW-Landing`) and from the Speculus simulation runtime while providing Speculus's launch and credential authority.

## Current direction

- Server-backed assets, not browser-local ownership
- Card-heavy blue warm moonlight interface
- Reusable Characters, Places, Items, Factions, Species, Societies, Families, Memories, and Worlds
- Curated Howling Whispers data first
- Speculus simulation launches from each Library record
- Canonical Bitterroot import from Rebrand
- Discord authentication, ownership and verified-access controls
- Protected Orbis administration and PostgreSQL-backed operational settings
- Encrypted user-owned NovelAI settings and short-lived generation grants

## Branch model

- `main` - stable root
- `dev` - integration branch
- `frontend` - Orbis UI and browsing
- `backend` - Orbis backend work until a shared API takes over common responsibilities
- `auth` - authentication/account integration
- `mailing` - verification/recovery/security mail integration
- `whispers-integration` - Project Whispers simulation integration
- `rebrand-integration` - Rebrand client integration
- `export-import` - HW asset/world package work

No formal release versioning or changelog is required during the current core-development stage.

## Local development

Requirements: Node.js 20 or newer and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

The development server opens on `http://localhost:5174`.

Set `VITE_ORBIS_API_URL` to the API base when using the server-backed frontend. `VITE_HW_LIBRARY_API_URL` remains a compatibility fallback. Leave both blank to use the temporary frontend fixtures. Run `npm run dev:api` separately when developing the PostgreSQL-backed API and administration area.

## Verification

```bash
npm test
npm run build
npm run preview
```

The production preview opens on `http://localhost:4174`. Production deployment also requires migration `004_speculus_bridge.sql`, a credential-encryption key, and the shared Speculus bridge secret described in `docs/platform/SPECULUS.md`.

## Source structure

- `src/api` contains the stable Orbis Library client boundary and fixture/HTTP implementations.
- `src/components` contains shared shell, card and state primitives.
- `src/features/library` contains temporary frontend fixtures.
- `src/views` contains the Orbis home, collections and record detail views.
- `src/types` contains shared asset and future simulation launch contracts.
- `src/admin` and `src/views/AdminView.tsx` contain the protected administration client.
- `server` contains Discord OAuth, access policy, settings, audit and Orbis Library endpoints.
- `server/data/bitterroot.json` contains the canonical Bitterroot source snapshot from Rebrand.
- `docs/platform/API_CONTRACT.md` documents the server contract.
- `docs/platform/ADMINISTRATION.md` documents configuration precedence, recovery and deployment requirements.
- `docs/platform/SPECULUS.md` documents the Orbis to Speculus launch and credential boundary.

## Bitterroot import

Migration `server/migrations/003_asset_documents.sql` adds structured record documents and stable source identities. After building the API, import the canonical Bitterroot snapshot with:

```bash
npm run import:bitterroot
```

The import assigns every Bitterroot record to Eirvargr's immutable Discord account `1544473372073791602`. Eirvargr must have signed in to Orbis at least once so that account exists in PostgreSQL. The import is additive and safe to rerun: existing imported records and later edits are not overwritten.

The imported collection contains 28 indexed records: the world, 2 species, 14 places, 1 faction, 6 societies, 1 family, 1 memory, and 2 linked characters.
