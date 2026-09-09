# Current Project Boundaries

This file exists to prevent historical project names and older implementations from bleeding into current work.

## Orbis owns

- reusable assets
- worlds and World Forge authoring
- standalone assets and optional world membership
- user ownership
- per-world and per-asset privacy/access controls
- account-facing settings
- Discord authentication and authorization
- administration
- provider credential custody
- issuing launch packages/grants to Speculus
- import/export of Orbis-owned authored data

## Speculus owns

- simulation sessions launched from Orbis
- roleplay/runtime state after launch
- use of the context package Orbis supplies
- runtime interaction with the shared generation boundary

Speculus does not own the canonical asset database or raw provider credentials.

## Fabula owns

Fabula-specific future systems and design, including gameplay/world-simulation mechanics that are not merely Orbis authoring controls. The current repository already contains the planned narrative dice/resolution system.

## Studium

Reserved until the repository defines its own implemented scope. Historical names or plans must not be assumed to be current Studium behavior.

## Mens

Reserved/private until the repository defines its own implemented scope. Do not infer implementation from old discussion alone.

## Legacy and historical sources

### HW-Library

Legacy predecessor of Orbis. It is not the destination for new Orbis implementation.

### Rebrand

Historical/source material only unless explicitly used for an import or migration. A Rebrand export can be input data without making Rebrand the project being edited.

### Old account/repository references

References to old GitHub ownership such as `FreakyHydra/...` are historical unless explicitly confirmed as current. Current work should target repositories under `HowlingWhispers`.

## Before coding

1. Confirm repository and branch.
2. Inspect current implementation.
3. Confirm the requested feature does not already exist behind a missing route/button.
4. Prefer exposing/reusing existing functionality over creating a parallel system.
5. Keep import/migration work separate from ordinary UI work where possible.
6. Do not treat historical memory as stronger than current repository state.
