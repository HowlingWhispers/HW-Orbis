# Orbis Library API client contract

The frontend consumes a server-backed Library API through `src/api/contracts.ts`.

Set `VITE_ORBIS_API_URL` to the API origin. `VITE_HW_LIBRARY_API_URL` remains supported as a compatibility fallback. When both are blank, the frontend uses development fixtures. Fixtures are temporary presentation data and are never treated as browser-owned records.

## Initial read endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/library/overview` | Category counts, recently edited records and pinned records |
| `GET` | `/v1/library/assets` | Search and filter globally indexed assets |
| `GET` | `/v1/library/assets/:id` | Fetch one complete Library record |

Supported asset query parameters are `type`, `search`, `sourceType` and `sort`.

## Stable frontend models

- `LibraryAsset` provides common identity, provenance, origin world, tags, dependency summary fields and a structured `document`.
- `AssetQuery` defines the first global index query surface.
- `SimulationTarget` describes the selected Library subject sent through the Speculus launch boundary.

## Authentication and visibility

Discord authentication uses same-origin routes under `/api/auth`. `GET /api/auth/me` returns the signed-in profile and the server-calculated `canViewAdult` and `canCreate` permissions.

Every asset has a `contentRating` of `sfw` or `adult`. When the current session cannot view adult content, list and overview responses retain a neutral card but replace all sensitive fields and set `restricted: true` with `verificationPath: /verification`. Direct detail requests return `403`.

## Initial write endpoints

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/v1/library/assets` | Accepted Discord creator role |
| `PATCH` | `/v1/library/assets/:id` | Matching immutable creator ID, or protected super administrator |

Records store `creator_user_id`. Responses join that ID to the creator's current profile, keeping visible author names fluid without weakening ownership.

The PATCH endpoint updates both the common Library card and the structured document. Stable source IDs are not editable. Ownership, not a refreshable Discord creator role, controls edits. Creator roles continue to control creation of new records. Adult visibility remains gated for other users, while an owner retains access to their own record.

## Speculus bridge

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/provider-settings/novelai` | Return safe connection status and model, never the token |
| `PUT` | `/api/provider-settings/novelai` | Encrypt and save the signed-in user's NovelAI token |
| `DELETE` | `/api/provider-settings/novelai` | Remove the signed-in user's saved token |
| `POST` | `/api/v1/library/assets/:id/simulate` | Box an accessible record and create a one-time Speculus launch |
| `POST` | `/api/v1/generation/speculus` | Redeem a scoped opaque grant from the Speculus server |

The internal generation route uses Bearer grants, is not a browser/session route, and never returns provider credentials. See `SPECULUS.md` for the complete deployment contract.

## Bitterroot source import

`server/data/bitterroot.json` is the canonical public Bitterroot snapshot imported from the Rebrand branch. `npm run import:bitterroot` creates 28 records with `source_type = public-curated`, stable `source_asset_id` values, and the Bitterroot world as the origin for every child record.

Every Bitterroot record belongs to the Orbis user whose immutable Discord ID is `1544473372073791602`. The displayed author name and avatar continue resolving from that user's current Orbis profile. The import uses insert-only conflict handling, so rerunning it never overwrites an existing record or an editor change.

## Administration

All routes below require a signed-in Discord user with effective Orbis administrator access. Server-side middleware enforces authorization.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/overview` | Non-secret operational and system status |
| `GET` | `/api/admin/settings` | Effective editable settings, source and fallback information |
| `PUT` | `/api/admin/settings` | Validate, persist and audit a complete operational settings update |
| `GET` | `/api/admin/audit` | Recent non-secret setting changes |
| `GET` | `/api/config/public` | Public Discord invite URL only |

The administration API never returns `DATABASE_URL`, `SESSION_SECRET` or `DISCORD_CLIENT_SECRET` values.
