# Howling Whispers Repository Map

This map is based on the repositories currently present under the `HowlingWhispers` GitHub account.

| Repository | Current role | Canonical branch | Status |
|---|---|---|---|
| `HW-Orbis` | Asset library, world authoring, ownership, privacy, account-facing controls, administration, launch authority | `main` | Active |
| `HW-Speculus` | Orbis-launched simulation/runtime service | `main` | Active |
| `HW-Fabula` | Fabula-specific planning and future gameplay/world-system implementation | `main` | Planning |
| `HW-Studium` | Reserved/placeholder repository | `main` | Placeholder |
| `HW-Mens` | Reserved/private placeholder repository | `main` | Placeholder |
| `HW-Library` | Historical predecessor of Orbis | `main` | Legacy |

## HW-Orbis

This is the current home for Orbis work. It contains frontend code, server code, migrations, tests, legal/platform documentation, World Forge editing, library browsing, authentication, administration, and Speculus integration.

Do not redirect new Orbis work into `HW-Library` or a Rebrand-era repository.

## HW-Speculus

Speculus is a separate runtime service. It is launched by Orbis using a prepared package and does not own Orbis assets or provider credentials.

## HW-Fabula

Fabula currently contains planning material, including the narrative dice/resolution design. Fabula-specific systems should live here instead of being placed in Orbis merely because Orbis is the current active application.

## HW-Studium

The repository currently contains only a minimal placeholder. Until its own documentation and implementation define a role, do not move active Orbis, Speculus, Fabula, or Mens work into it.

## HW-Mens

The repository currently contains only a minimal placeholder and is private. Treat it as reserved until its own scope is defined.

## HW-Library

This repository predates the current Orbis repository and retains older branch structure and historical implementation. It should be treated as read-only historical reference for normal development. New Orbis changes belong in `HW-Orbis`.

## Repository selection rule

When a feature could fit more than one project, choose the repository that owns the runtime responsibility, not the repository where an older version of the idea happened to exist.
