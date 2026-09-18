# Current Project Boundaries

This file exists to prevent historical project names and older implementations from bleeding into current work.

## Orbis owns

- reusable canonical assets and worlds
- World Forge and other authoring/editing surfaces
- stable entity identity and relationships between authored records
- user ownership, privacy, access controls, account settings and administration
- provider credential custody
- versioned World Brain source/revisions and the world's selected effective brain
- authored definitions for runtime-capable data such as items, equipment, traits, abilities, schedules, relationship archetypes, resources, mysteries/reveal plans and world rules
- import/export, validation and revision history for Orbis-owned authored data
- issuing versioned launch packages/grants to the simulation runtime
- archival/storage services for runtime saves without becoming the runtime authority for those saves

Orbis describes canonical reality. It does not execute the simulation.

## Speculus V3 owns the future Fabula runtime

Speculus V3 is the experimental incubation path for the runtime that will become Fabula when it is mature enough. Fabula is not a separate rewrite or parallel implementation unless the owner explicitly changes that direction.

V2 remains the stable Speculus baseline while V3 replaces V2-derived systems incrementally.

V3 owns:

- simulation sessions launched from Orbis
- mutable runtime state after launch
- authoritative world clock, scene/location, presence and travel state
- deterministic state transitions and action resolution
- runtime character state, schedules, autonomy and off-screen activity
- runtime inventories/equipment/conditions/resources
- runtime relationships, knowledge boundaries, mystery/reveal progress and chronicles
- dice/skill checks, encounters, consequences and other game mechanics as V3 grows toward Fabula
- context compilation and World Brain execution
- use of the generation package and shared Orbis generation boundary
- save semantics, reroll/undo ownership and state ledgers

Speculus/Fabula does not own the canonical asset database or raw provider credentials.

## Promotion to Fabula

The intended lifecycle is:

`Speculus V2 stable -> Speculus V3 experimental -> V3 reaches runtime/gameplay readiness -> promote/rename V3 as Fabula`

Do not build a second Fabula runtime beside V3. New gameplay/world-simulation work should be designed so it can land in the V3 runtime and survive the eventual product-name promotion.

## Canon versus runtime state

A canonical Orbis definition and a mutable runtime value are different things.

Examples:

- Orbis item record: what a sword is. V3/Fabula inventory state: who currently carries that sword, quantity, condition and whether it is equipped.
- Orbis place record: what Brackenjaw is and where it belongs in the authored world graph. V3/Fabula scene state: who is there now and what time they arrived.
- Orbis relationship archetype/history seed: authored starting truth. V3/Fabula relationship state: trust, events and progression caused by play.
- Orbis mystery: hidden truth, reveal plan and initial knowledge. V3/Fabula runtime: who has learned what and which reveal stage is active.
- Orbis World Brain revision: authored simulation constitution. V3/Fabula: executes the pinned revision against current state.

Generated/runtime changes do not silently rewrite Orbis canon. A later promotion workflow may intentionally turn selected runtime developments into authored canon.

## World Brain boundary

Orbis is the authoring and revision authority for World Brain documents. Published revisions should be immutable and worlds should resolve to exactly one effective brain: a maintained Standard World Brain or a custom world brain revision.

Speculus V3/Fabula executes that effective brain. Runtime code still owns deterministic invariants such as identity, permissions, clock arithmetic, inventory arithmetic, travel costs and state commits. A World Brain can define behavior and interpretation rules but cannot bypass the runtime's safety/consistency boundary.

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
5. Keep canonical authoring/import work separate from runtime state execution.
6. Do not treat historical memory as stronger than current repository state.
