# Simulation authoring architecture

This document defines how Orbis should grow alongside Speculus V3 while V3 develops systems that may later contribute to Fabula.

The main boundary is simple:

> Orbis authors, validates, versions and distributes canonical definitions. Speculus V3 executes those definitions as mutable simulation state. Future Fabula may reuse or adapt these proven contracts after its separate design phase.

This avoids two failure modes: putting game logic in the library server, or letting generated prose silently become canonical data.

## Research inputs

The design has been informed by NovelAI userscripts supplied for architectural study, including Character Engine, World Explorer, Adventure Engine, Living Chronicle/Chronicle Tracker, Relationship Keeper, Persona Keeper, Mystery Keeper, Story State Tracker, inventory/equipment/wardrobe helpers, character/world traits, skill systems and ChatRPG.

Use those projects as research specimens only. Do not vendor or copy their implementation. Re-implement useful concepts in Howling Whispers architecture and terminology.

Important lessons extracted from the research:

- persistent data needs an explicit source of truth
- model context should be a projection of state, not the state store itself
- irreversible writes should pass through one reviewed/validated commit path
- generation can propose classifications or drafts, but deterministic code should own discrete state changes
- context should be assembled as prioritized whole blocks instead of arbitrary tail chopping
- history-aware state must understand reroll/undo rather than double-applying consequences
- secrets and per-character knowledge require explicit visibility boundaries
- long-running continuity benefits from short-term state, longer chronicle summaries and archival tiers
- world time, location, travel, schedules, inventories and relationships should be real state rather than remembered prose

## Canonical authoring domains

Orbis should progressively gain first-class authoring support for these domains. The first implementation may continue storing them inside JSON documents; first-class tables are warranted only when query, revision, sharing or referential-integrity needs justify them.

### World Brain

A world resolves to one effective World Brain.

A brain has:

- a stable brain identity
- editable draft source
- immutable published revisions
- revision notes and timestamps
- Standard or Custom origin
- world binding to a specific published revision
- explicit reset-to-Standard behavior that does not destroy custom history

The launch package should eventually identify the selected brain and immutable revision. V3 should never guess which revision was intended.

### World graph and spatial canon

Orbis owns stable definitions and links for:

- worlds, regions, places and nested locations
- roads/routes and authored travel relationships
- factions, societies, families and species
- items, equipment and other reusable objects
- optional map/hex/spatial metadata
- schedules, calendars and environmental rules
- authored encounter/faction/resource definitions

Runtime position, current presence, travel progress, conquest state and current environmental state belong to V3.

### Character definitions

Character records should be able to author:

- persona/idiolect and behavioral traits
- physical/biographical data
- skills and abilities
- schedules/home locations
- starting equipment/inventory references
- relationship seeds/archetypes
- knowledge seeds and secrets
- goals, affiliations and faction membership

A character definition is not a mini World Brain. One effective World Brain interprets character data.

### Items, inventory and equipment

Orbis owns item definitions and equipment rules. Runtime inventories should reference canonical item IDs rather than cloning free-text descriptions whenever possible.

Useful authored fields include category, tags, stackability, mass, equipment slot, durability model, consumable behavior, value/economy metadata and world-specific rules.

V3 owns runtime item instances, quantities, location/owner, equipped state, current durability and transaction history.

### Relationships

Orbis owns relationship vocabulary, archetypes, starting conditions and authored history. V3 owns runtime pair-state and relationship events.

Relationship records should support more than a single score. The research shows value in events, unresolved threads, stages and pacing controls. The final Howling Whispers design should preserve semantic factors/events and optionally derive compact numeric values for mechanics.

### Knowledge, secrets and mysteries

Orbis owns objective hidden truth, reveal plans, initial knowledge and visibility constraints. V3 owns the current knowledge graph and reveal progress.

Every context block derived from hidden information must declare who is allowed to receive it. Player-visible rendering must never receive an NPC-only secret merely because it is present in the launch package.

### Traits, abilities, skills and resources

Orbis owns reusable definitions. V3 owns current values, temporary modifiers, checks, spend/recovery and consequences.

This covers character/world traits, spells/abilities, skill definitions, resource tracks, wounds/strain, conditions, survival needs, currencies and other world-specific mechanics.

## Runtime launch projection

Orbis should not dump the entire library into a prompt. It should build a versioned launch package containing canonical records plus stable IDs/revisions.

A future V3 launch projection should distinguish:

- source identities/revisions
- effective World Brain revision
- world graph records needed by the session
- character/persona definitions
- authored rules/definitions
- initial runtime seed state
- visibility/knowledge metadata

The runtime then compiles model context from this structured package and current mutable state.

## Runtime save boundary

The runtime save is not an Orbis world document.

A save may contain mutable state such as time, presence, inventories, relationship progression, wounds, resources, encounter state, faction changes and chronicle memory. Orbis may archive and sync that save, but it should treat it as a versioned runtime artifact.

If the owner later wants a playthrough change promoted into world canon, build an explicit review/promote workflow rather than silently merging the save back into canonical records.

## Authoring workflow

For AI-assisted world creation inside Orbis, use a staging pattern:

`generate draft -> validate -> review/edit -> commit canonical record`

The generator should not directly mutate canonical world records. Batch generation should return drafts. A single commit path should assign IDs, validate links and perform writes.

This pattern is especially appropriate for proposed locations, factions, items, characters, schedules and World Brain revisions.

## Import strategy

Existing stories and external formats should be import sources, not alternate authorities.

Import should:

- parse into staging records
- preserve source IDs/aliases when useful
- detect likely links to existing canonical records
- warn about conflicts and dangling references
- allow selective commit
- never overwrite unrelated canonical fields merely because an import omitted them

World backup/export remains a full-fidelity path distinct from merge-style imports.

## Implementation order

Fabula's official product design, interface and theme are intentionally out of scope here. These contracts should be portable enough to inform that later design without pre-deciding it.

1. World Brain revision/binding model and launch contract.
2. Shared canonical simulation schema vocabulary for items, relationships, traits, abilities, schedules, secrets and resources.
3. V3 launch projection support for those authored definitions.
4. Authoring/editor surfaces and validation in World Forge/record editors.
5. Runtime-save archive versioning for the expanded V3 state.
6. AI-assisted staging/import tools after the canonical contracts are stable.

Do not create every table and editor at once. Stabilize one contract, add validation and launch projection, then expose the editor.
