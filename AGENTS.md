# Orbis repository rules

- Work on `main`. Temporary feature branches are non-authoritative until merged into `main`.
- `HowlingWhispers/HW-Orbis` is the canonical Orbis repository. `HW-Library` and Rebrand repositories are historical sources only.
- Keep Orbis responsible for canonical assets, worlds, ownership, privacy, account settings, provider credentials, administration, imports/exports, and Speculus launch authority.
- Keep Speculus runtime behavior out of Orbis except for the versioned launch and generation bridge contracts.
- Never commit private world backups, reconstructed imports, credentials, tokens, or real `.env` files. One-off private import payloads belong outside Git.
- Preserve immutable creator provenance and enforce adult/private access on the server. Current world control may move only through the explicit Orbis ownership-transfer flow; never rewrite or discard the original creator attribution.
- Coda is the library's mascot/host, not the application name. Technical services, routes, errors, and account controls must say Orbis.
- Before completion run `npm test`, `npm run lint`, and `npm run build` with `VITE_ORBIS_API_URL` configured.
