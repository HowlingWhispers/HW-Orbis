# Orbis administration

The protected control room is available at `/admin`. Both the frontend and every `/api/admin` endpoint enforce the signed-in state, while the API is authoritative for administrator permission.

## Capability separation

- Adult viewing requires a role in the effective Adult Access list.
- Creation requires both Adult Access and a role in the effective creator list.
- An empty creator list explicitly falls back to Adult Access roles.
- Administration requires an editable administrator role or a server-controlled bootstrap recovery role.
- Administration never implies adult viewing or creation.
- Discord role hierarchy and role names are never authorization inputs.

## Configuration precedence

Configuration has one direction of precedence:

1. Required protected server configuration supplies secrets and connection details.
2. Persisted PostgreSQL settings override compatibility environment values for editable operational settings.
3. Existing non-secret environment values remain compatibility fallbacks until a corresponding database setting is saved.
4. Safe application defaults apply when neither PostgreSQL nor the environment supplies a value.

This keeps existing deployments working without making the environment file and database competing sources of truth. The control room labels the active source for every editable setting.

## Server-only values

These values are never stored by the administration settings model and are never returned by the API:

- `DATABASE_URL`
- `SESSION_SECRET`
- `DISCORD_CLIENT_SECRET`

The System panel reports only `Configured` or `Missing`.

## Editable PostgreSQL settings

| Stable key | Purpose |
| --- | --- |
| `discord.guild_id` | Guild used for membership and role checks |
| `discord.adult_role_ids` | Roles allowed to view adult records |
| `discord.creator_role_ids` | Roles allowed to create when Adult Access is also present; empty means fallback |
| `discord.admin_role_ids` | Roles allowed to administer Orbis |
| `discord.invite_url` | Public website verification invite |

`server/migrations/002_admin_settings.sql` creates `app_settings`, `admin_setting_audit`, and the user admin-access column. Every changed setting is audited with its previous non-secret value, new non-secret value, actor and timestamp.

## Recovery access

`DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS` is always unioned with the effective editable administrator roles. It is never editable through Orbis. Keep at least one tightly controlled Discord recovery role in this value. The environment `DISCORD_GUILD_ID` also remains the recovery guild, so a mistaken editable guild ID cannot remove the bootstrap route.

The API rejects all settings updates until both the recovery guild and at least one bootstrap recovery role are configured on the server. This protects new installations from saving an immediate or delayed total lockout.

## Discord role names

The existing OAuth scopes identify the signed-in member and their exact role IDs. They do not provide the full guild role directory. Orbis therefore displays authoritative IDs rather than inventing role names. Adding a separately approved Discord integration for role-directory lookup is intentionally outside this phase.

## Kilo deployment update

1. Pull the final `dev` commit.
2. Apply `server/migrations/002_admin_settings.sql` after migration 001.
3. Add `DISCORD_ADMIN_ROLE_IDS` and `DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS` to the protected environment.
4. Optionally set `ORBIS_VERSION` and `ORBIS_BUILD_SHA` for the read-only System panel.
5. Keep all existing operational Discord values during the transition. They remain fallbacks.
6. Rebuild and restart Orbis.
7. Sign in with a configured administrator or bootstrap role and verify `/admin`.
