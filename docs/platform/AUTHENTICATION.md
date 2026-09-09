# Orbis Discord authentication and permissions

Orbis uses Coda's Discord OAuth application to identify users. The bot token is not used for website login and must never be added to the browser build.

## Access policy

| Visitor | SFW records | Restricted cards | Adult record details | Create | Edit |
| --- | --- | --- | --- | --- | --- |
| Public or signed out | Visible | Redacted as **Not verified** | Blocked | Blocked | Blocked |
| Discord member without an accepted role | Visible | Redacted as **Not verified** | Blocked | Blocked | Blocked |
| Member with an adult role | Visible | Visible | Visible | If the role is also in `DISCORD_CREATOR_ROLE_IDS` | Own records only |
| Member with a creator role but no adult role | Visible | Redacted | Blocked | Blocked | Blocked |

The role checks are server-side. Restricted names, descriptions, tags, authors, world names and relationship counts are replaced before a response leaves the API.

Discord role hierarchy is not treated as age verification. Configure the exact `18+ Access` role ID. A creator must also hold an Adult Access role. Administrator, Moderator and Developer roles never imply adult access.

## Identity and authorship

- Ownership uses Orbis' internal UUID linked to the immutable Discord user ID.
- The first display name defaults to the Discord global name, then the Discord username.
- Users may customize their Orbis display name. Later Discord logins do not overwrite a customized name.
- Asset responses resolve the creator's current display name, so author labels remain fluid.
- Discord avatar and avatar decoration refresh on login when Discord supplies them.
- Discord does not expose a dependable custom username font through OAuth. Orbis uses its own typeface for names.

## Discord application settings

OAuth scopes requested by Orbis:

- `identify`
- `guilds.members.read`

Registered redirect URIs:

- `https://lib.thehowlingwhispers.com/api/auth/discord/callback`
- `http://localhost:5174/api/auth/discord/callback`

## Production setup for Kilo

1. Install PostgreSQL and create an Orbis database/user.
2. Apply `server/migrations/001_auth_and_library.sql`, then `server/migrations/002_admin_settings.sql` to that database.
3. Copy `.env.example` to a protected production environment file outside the repository.
4. Set `APP_ORIGIN=https://lib.thehowlingwhispers.com`.
5. Set `DISCORD_REDIRECT_URI=https://lib.thehowlingwhispers.com/api/auth/discord/callback`.
6. Set Coda's client ID and client secret directly on the server. Do not post the secret in chat or commit it.
7. Set `DISCORD_GUILD_ID` to The Howling Whispers server ID.
8. Set `DISCORD_ADULT_ROLE_IDS` to the accepted 18+ role IDs.
9. Set `DISCORD_CREATOR_ROLE_IDS` to the roles allowed to create. Leave it blank to use the adult role list.
10. Set `DISCORD_ADMIN_ROLE_IDS` for the initial administrator-role fallback and set at least one `DISCORD_BOOTSTRAP_ADMIN_ROLE_IDS` recovery role.
11. Generate a random `SESSION_SECRET` of at least 32 characters and set `NODE_ENV=production` and `TRUST_PROXY=true` behind nginx.
12. Build with `npm ci && npm run build`, start with `npm run start:api`, and proxy `/api/` to the configured API port.
13. Serve the site at `lib.thehowlingwhispers.com` and route all other paths to the React application.

Use Discord Developer Mode to copy server and role IDs. Role names are deliberately not accepted because names can be changed or duplicated.
