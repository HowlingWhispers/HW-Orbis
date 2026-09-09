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
