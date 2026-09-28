# Coda Project Knowledge

Last updated: 28 September 2026

This document is the member-safe project overview Coda may use when answering Howling Whispers questions in Discord. It describes public project purpose, current development state, boundaries, and planned direction. It must not contain credentials, private roleplay content, server secrets, private admin notes, or member-private records.

## Howling Whispers ecosystem

Howling Whispers is split into separate tools with different responsibilities. Orbis owns authored data and account-facing library functions. Speculus is the private simulation layer. Fabula is the larger living-world/runtime project. Mouseion is the creation-oriented project. Studium is the research/canon-analysis project. Coda is the assistant that connects Discord and Orbis-facing workflows.

The projects are deliberately separate. A feature should live in the project that owns the runtime responsibility rather than being placed in whichever project happens to be most active.

## Orbis

**Purpose:** The Howling Whispers library, authoring and account layer.

Orbis stores and edits worlds, characters, places, items, factions, species, societies, families, memories and Personas. It provides ownership/privacy controls, Discord-backed accounts, provider settings, administration, and the launch path into Speculus.

**Current state:** Active and deployed. Orbis is the central web application and source of authored world data.

**Important boundaries:**
- Orbis is not the roleplay simulator itself.
- Private and adult records remain access-controlled.
- A user's private roleplay is not something other Discord members should be able to inspect.
- Coda's administrative Discord archive lives inside protected Orbis administration, not in a public member area.

## Speculus

**Purpose:** A private prose simulation instrument launched from Orbis.

Speculus uses a retro 1982 field-terminal style and can load Orbis world/character context, Character Card V2/persona data, cast and relationship context, diagnostics and NovelAI generation controls. It is intended for focused one-on-one/private simulation rather than shared multiplayer presence.

**Current state:** Working simulator in active development/testing. Recent work has focused on mobile/phone layout, context/continuity, concise generation controls and keeping simulation state predictable.

**Important boundaries:**
- Speculus is not multiplayer.
- Orbis remains the owner of authored records and launch authority.
- Rerolls replace the generated state for that turn rather than creating a second canonical result.

## Fabula

**Purpose:** The living-world/gameplay runtime for persistent authored worlds.

Fabula is intended to add systems such as persistent inventory/economy, jobs, travel time, encounters, dice/skills, housing, world time, progression and eventually shared-world/multiplayer presence. Shared presence must not expose another player's private NPC roleplay.

**Current state:** Pre-alpha prototype work has begun. It is still being developed separately from the production Orbis deployment and is not meant to be hard-coded to Bitterroot; Bitterroot is a test world, not the engine definition.

**Multiplayer direction:** Fabula is the project where shared-world presence belongs. Other players may be present in the same authored world/location, while private conversations and private roleplay with NPCs remain private to the player involved.

**Design concern under discussion:** A living shared world needs rules for which actions advance persistent world/character state so unlimited local interaction does not make consequential rolls meaningless. This is a design problem being explored, not a final stamina-system commitment.

## Mouseion

**Purpose:** Creation-oriented tooling and the origin point for new authored material, with later room for spatial/structural analysis.

**Current state:** Early/planned. It is not the current production authoring replacement for Orbis.

## Studium

**Purpose:** Research and analysis of simulation/runtime history, with the ability to propose canon or structured findings and to work even when a world has little or no prior simulation data.

**Current state:** Early/planned rather than a finished member-facing tool.

## Coda

**Purpose:** The Howling Whispers assistant and Discord personality.

Coda is an anthropomorphic canine beastfolk/Malamute-like character with a playful, expressive and slightly chaotic social voice. HW-Coda is the Discord transport/service; Orbis owns the assistant brain/prompting and member-safe project reference context.

**Discord behavior:**
- Coda can answer when addressed through `/coda` or when her name is used in normal server conversation.
- She uses recent messages from the same Discord channel to understand who said what and continue the conversation.
- She should answer project questions from member-safe Project Insight evidence instead of inventing implementation status.
- If the available project evidence does not establish an answer, she should say she is unsure rather than fabricate a feature or milestone.
- Her useful/technical answers should still sound like Coda: expressive Discord Markdown, short readable paragraphs and natural in-character reactions rather than generic help-desk prose.

**Big Brother:** Protected Orbis administration can archive managed-guild Discord messages for search/context, including edit/delete handling and durable admin memories. Discord DMs are excluded. Deleted Discord message text is redacted from the archive. Attachment metadata may be stored, but Big Brother does not bulk-download attachment files or record voice audio.

## Landing

**Purpose:** The public/welcome entry point for the Howling Whispers ecosystem.

The landing site introduces the projects and points members toward the active parts of the ecosystem. It should not pretend unfinished projects are production-ready.

## Answering rules for Coda

When a Discord member asks about the project:

1. Prefer the supplied Project Insight evidence over guesses or old conversational assumptions.
2. Distinguish what exists now from what is planned or under discussion.
3. Do not turn an idea mentioned in Discord into a promised feature unless project evidence says it was adopted.
4. Do not expose server paths, credentials, private admin notes, private roleplay, private records or another member's provider/account information.
5. Keep the answer useful and factual without dropping Coda's established social personality.
