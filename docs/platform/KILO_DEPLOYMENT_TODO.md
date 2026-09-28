# Orbis and Speculus deployment checklist

This checklist connects the Orbis build in `/var/www/hw/orbis-next` to the Speculus build in `/var/www/hw/speculus`. It is a planning document only; do not apply these steps to the live deployment until the destination has been reviewed and approved.

- [ ] Record the approved Orbis and Speculus commits before deployment.
- [ ] Apply `server/migrations/004_speculus_bridge.sql` to the Orbis PostgreSQL database.
- [ ] Generate an independent 32-byte base64 `ORBIS_CREDENTIAL_ENCRYPTION_KEY`.
- [ ] Generate one `SPECULUS_BRIDGE_SECRET` and install the same value in both protected service environments.
- [ ] Set Orbis `SPECULUS_BRIDGE_URL=http://127.0.0.1:8790` and `SPECULUS_LAUNCH_TTL_SECONDS=14400`.
- [ ] Set Speculus `ORBIS_GENERATION_API_URL=http://127.0.0.1:8789/api/v1/generation/speculus` and `SPECULUS_PUBLIC_ORIGIN=https://spec.thehowlingwhispers.com`.
- [ ] Build Speculus with `SPECULUS_UPDATE_DATE` set to the deployment date so the terminal version matches its last software update.
- [ ] Build Orbis, build Speculus, and restart `orbis.service` and the Speculus service.
- [ ] Build Orbis with `VITE_ORBIS_API_URL=/api` so production uses the live API instead of presentation fixtures. The legacy `VITE_HW_LIBRARY_API_URL` name remains a compatibility fallback.
- [ ] Attach `spec.thehowlingwhispers.com` to the loopback Speculus service on port `8790` with HTTPS.
- [ ] Confirm a direct visit to the Speculus domain shows the missing-system-medium boot failure.
- [ ] In Orbis Account, save a NovelAI token and confirm the API never returns the token value.
- [ ] Open an Orbis record, select **Simulate**, complete one roleplay turn, and inspect safe diagnostics.
- [ ] Verify the owner can edit their own Orbis record even when `canCreate` is false. This is the production check for the recurring lost-edit-permission regression.
- [ ] Verify a different user still receives `403` when attempting to edit that record.
- [ ] Verify creator and adult Discord roles still control new-record creation and access to other users' adult records.
- [ ] Apply `server/migrations/022_asset_images.sql` to the Orbis PostgreSQL database. *(Already applied 2026-09-27 to the current live database behind `orbis.service` in `/srv/howling-whispers/orbis`; `library_asset_images` and `admin_view_preferences` exist with 0 rows. Still required for any other target database, because Orbis has no migration runner — every migration is applied by hand with `psql -f`.)*
- [ ] Apply `server/migrations/026_coda_big_brother.sql` before deploying the Big Brother routes. This creates the Discord archive, revision and durable-memory tables. Orbis has no automatic migration runner, so this must happen before the service restart.
- [ ] Create the local image media root (`ORBIS_MEDIA_ROOT`, default `/srv/howling-whispers/orbis-media`) outside the repository and confirm it is writable by the `orbis.service` user. Confirm the media root is never served by the reverse proxy or by `express.static`. *(Boot already creates the directory; only the proxy-exposure check remains.)*
- [ ] Confirm a local upload over 1 MB is refused with a clear 413, and that a non-image upload is refused regardless of its `Content-Type` or filename.
- [ ] Confirm cover and gallery artwork stays private: an image on a private or adult record must not load for another user without access.
- [ ] In the control room Overview panel, confirm **Hide private user worlds** is on by default, that another member's private world is absent from the Worlds list, and that turning it off reveals it. Confirm the preference survives a reload and that a direct link to that world still opens.

## Coda Big Brother + Project Insight rollout

Big Brother now belongs to **Orbis Administration**. HW-Coda only captures the managed Discord guild and forwards normalized create/edit/delete events over the protected internal bridge.

Deploy in this order:

```bash
cd /srv/howling-whispers/orbis

git fetch origin
git checkout main
git pull --ff-only origin main
npm ci
npm test
npm run lint
npm run build

# Orbis has no migration runner. Use the production DATABASE_URL/environment
# and apply this before the restart.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/migrations/026_coda_big_brother.sql

sudo systemctl restart orbis.service
sudo systemctl status orbis.service --no-pager
curl -fsS http://127.0.0.1:8789/api/health
```

Only after Orbis is healthy should Kilo update/restart `/srv/howling-whispers/coda` and `hw-coda.service`.

Production checks:

- Open Orbis Administration → **Big Brother** and confirm Messages, Memory, People and Channels load.
- Send a Discord server message and confirm it appears in Big Brother.
- Edit it and confirm the current text changes while revision history keeps the replaced version.
- Delete it and confirm the archived text/attachments and stored old revisions are redacted; source-linked message memories are removed.
- Confirm a Discord DM is not captured.
- Ask Coda a casual question and confirm she keeps expressive Discord Markdown/actions rather than producing a dry help-desk wall.
- Ask a project question such as `Coda, what is Fabula meant to become?` and confirm she uses the member-safe Project Insight reference while distinguishing current work from plans.

Project Insight is intentionally separate from the Discord transcript. It only indexes explicitly member-safe project sources (root README/CHANGELOG/ROADMAP/STATUS-style files plus `docs/CODA_PROJECT_KNOWLEDGE.md`) and safe Git branch/SHA/update-time metadata. It must not expose deployment runbooks, credentials, private admin notes or private roleplay.

## Deploy ordering: build, then restart, as one step

The web client is served from `dist/` **on disk at request time**, while the API routes
are loaded into memory once at boot. A `npm run build` without a `systemctl restart`
therefore leaves the newest client talking to the previous server, and the browser starts
requesting endpoints the running process does not have. Restart and build together; never
treat a successful build as a deployment.

Unmatched `/api/` paths now return a JSON 404 rather than falling through to the single-page
app, so this skew is visible in the response body instead of surfacing as a JSON parse error
inside the client. When you see "That Orbis API endpoint does not exist… reload", the fix is
a restart, not a client bug.

Because there is no migration runner, a restart cannot create the tables a new feature needs.
Apply the migration with `psql -f` **before** restarting onto code that queries it, or the
new routes will answer with a database error until the schema catches up.

## World-child link maintenance

`npm run link:world-children` repairs canonical children that exist in a world but are missing from that world's projection. It is **additive only**: it adds the missing `libraryAssetId` / `worldEntryId` links and never rewrites, renames, re-describes or removes authored content, and never deletes a child. `DATABASE_URL` is mandatory and **dry run is the default**; pass `--apply` only after reviewing the exact plan and taking a fresh backup. Re-running it after a successful apply is a no-op.

Use it after any import path that creates `origin_world_id` children without mirroring them, and verify with `npm run check:world-integrity`, which should report `Embedded projections` equal to `Canonical child rows` with zero errors and zero warnings.
