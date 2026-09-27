# Orbis repository rules

- Work on `main`. Temporary feature branches are non-authoritative until merged into `main`.
- `HowlingWhispers/HW-Orbis` is the canonical Orbis repository. `HW-Library` and Rebrand repositories are historical sources only.
- Keep Orbis responsible for canonical assets, worlds, ownership, privacy, account settings, provider credentials, administration, imports/exports, and Speculus launch authority.
- Keep Speculus runtime behavior out of Orbis except for the versioned launch and generation bridge contracts.
- Never commit private world backups, reconstructed imports, credentials, tokens, or real `.env` files. One-off private import payloads belong outside Git.
- Preserve immutable creator provenance and enforce adult/private access on the server. Current world control may move only through the explicit Orbis ownership-transfer flow; never rewrite or discard the original creator attribution.
- Coda is the library's mascot/host, not the application name. Technical services, routes, errors, and account controls must say Orbis.
- Before completion run `npm test`, `npm run lint`, and `npm run build` with `VITE_ORBIS_API_URL` configured.

## Deployment: known trap

Building `dist-server/` is **not** the same as deploying it. `orbis.service` runs
`node dist-server/index.js` as a long-lived process that loads the compiled
output once at startup. After any server-side route or handler change:

1. Build `dist-server/`.
2. **Restart `orbis.service`.** A build alone leaves the old code in memory, and
   the stale process keeps answering from the code it loaded at startup.
3. Verify the new endpoint directly after the restart, not just through the UI.

A frontend that is deployed and correct can still show its own error copy while
the API is silently a build behind, so a page error is not evidence that the
frontend is at fault. Check `MainPID` and `ActiveEnterTimestamp` against the
`dist-server` build timestamp before investigating any code. If the compiled
output contains the route but the process predates it, it is only a restart —
do not start changing working code.

Migrations are applied by hand with `psql -f` in numeric order; there is no
migration runner. Database connection settings live in
`/etc/howling-whispers/orbis.env`, not in the repo.
