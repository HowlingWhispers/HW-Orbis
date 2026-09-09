# Current Howling Whispers State

This document is the current baseline for development. Historical chat notes, old repository names, retired branches, and Rebrand-era assumptions do not override it.

## Canonical rule

Before changing a project, use the current repository under the `HowlingWhispers` account and its `main` branch as the source of truth.

## Current repositories

- `HowlingWhispers/HW-Orbis` - active Orbis application and API. Canonical branch: `main`.
- `HowlingWhispers/HW-Speculus` - active Speculus simulator/runtime. Canonical branch: `main`.
- `HowlingWhispers/HW-Fabula` - Fabula planning/future implementation home. Canonical branch: `main`.
- `HowlingWhispers/HW-Studium` - placeholder repository. No implemented system is established by the repository yet.
- `HowlingWhispers/HW-Mens` - private placeholder repository. No implemented system is established by the repository yet.
- `HowlingWhispers/HW-Library` - historical predecessor of Orbis. Do not start new Orbis work here.

## Orbis branch warning

`HW-Orbis` currently also has `feature/private-world-import`. It is an unmerged temporary branch and is not authoritative. New work should be based on `main` unless explicitly instructed otherwise.

## Historical material

Rebrand-era world exports, old Library code, and other previous projects may still be valuable as import sources or historical references. They are not current implementation targets unless a current repository explicitly says they are.

## Change discipline

1. Identify the current repository first.
2. Read its current `main` code and docs before designing replacement systems.
3. Reuse working current UI and APIs instead of recreating them from historical descriptions.
4. Keep temporary branches clearly temporary.
5. Do not deploy, migrate, or import production data as a side effect of documentation or planning work.
