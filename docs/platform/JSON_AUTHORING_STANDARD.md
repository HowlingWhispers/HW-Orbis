# Howling Whispers JSON Authoring Standard

Status: authoring format v1

This document defines the human-editable JSON style used when a creator wants to prepare a World outside Orbis and then load it through **Create World → Import JSON**.

The purpose is consistency: a human, Coda, Orbis, or another Howling Whispers tool should be able to look at an authoring file and immediately know what it represents and where the editable world data lives.

## Golden rule

**The outer object tells Orbis what the file is. `data` contains the world document. Orbis owns the structure; humans and Coda fill or edit the content. Nothing becomes an Orbis record until the creator reviews it and explicitly saves/creates it.**

## Strict JSON versus commented examples

Real `.json` files do **not** support comments. The commented examples below use JSONC-style `//` comments only to explain the format line by line.

- Use the **Clean JSON** example or Orbis's **Download blank template** button for a file you intend to import.
- Do not leave `// comments` or `/* comments */` in a real JSON import.
- Do not use trailing commas.
- Property names and string values use double quotes.

## Commented world template

The following is documentation, not directly importable JSON because it contains comments.

```jsonc
{
  // Identifies this as the human-editable Orbis authoring format.
  "format": "orbis-authoring",

  // Version of this authoring schema. Orbis currently accepts version 1.
  "schemaVersion": 1,

  // Tells Orbis what kind of asset is being authored.
  // This importer currently expects "world".
  "assetType": "world",

  // Human-readable World name shown in Orbis.
  "name": "Untitled World",

  // Short description used on cards and search results.
  // Keep this brief; long lore belongs inside data.
  "summary": "",

  // Overall Orbis content rating for the World root.
  // Valid values are "sfw" or "adult".
  "contentRating": "sfw",

  // Search/filter labels. Each entry is one separate tag.
  "tags": [],

  // Visual card theme used by Orbis.
  // Valid values: moon, forest, ember, mist, violet, river.
  "visualTone": "moon",

  // Everything below data is the editable World document.
  "data": {

    // Identity is the World-level name and introductory description.
    "identity": {
      // The World name is repeated here because World Forge uses identity.name.
      "name": "Untitled World",

      // Main prose description of the World.
      "description": "",

      // Freeform genre description, for example "dark fantasy".
      "genre": "",

      // Freeform tone description, for example "quiet, eerie, hopeful".
      "tone": ""
    },

    // Broad canon that does not belong to one separate record.
    "lore": {
      // World history in prose form.
      "history": "",

      // Broad cultural notes that apply across the World.
      "cultures": "",

      // Customs or recurring practices shared at World level.
      "customs": "",

      // Important facts is an array because it can contain multiple entries.
      "importantFacts": []
    },

    // World-level simulation/canon rules. Keep this as an object.
    "rules": {},

    // Arrays below hold zero or more structured entries.
    // Each child record should keep a stable id if other entries refer to it.
    "species": [],

    // Places are stored under locations in the current World Forge schema.
    "locations": [],

    // Organized groups, powers, guilds, clans, etc.
    "factions": [],

    // Peoples, cultures, communities and social structures.
    "societies": [],

    // Family or lineage structures.
    "families": [],

    // Timeline events and persistent memories.
    "memories": [],

    // World clock, calendar and weather configuration.
    "timeWeather": {},

    // World privacy settings.
    // Imports are always forced back to private for review, even if a file says public.
    "worldSettings": {
      // private means only the owner may access the World by default.
      "visibility": "private",

      // false keeps the World out of public browsing.
      "showInLibrary": false,

      // false prevents forking until the owner deliberately changes it later.
      "allowForking": false
    }
  }
}
```

## Clean importable JSON

This version contains no comments and can be saved as `my-world.json` and loaded into Orbis.

```json
{
  "format": "orbis-authoring",
  "schemaVersion": 1,
  "assetType": "world",
  "name": "Untitled World",
  "summary": "",
  "contentRating": "sfw",
  "tags": [],
  "visualTone": "moon",
  "data": {
    "identity": {
      "name": "Untitled World",
      "description": "",
      "genre": "",
      "tone": ""
    },
    "lore": {
      "history": "",
      "cultures": "",
      "customs": "",
      "importantFacts": []
    },
    "rules": {},
    "species": [],
    "locations": [],
    "factions": [],
    "societies": [],
    "families": [],
    "memories": [],
    "timeWeather": {},
    "worldSettings": {
      "visibility": "private",
      "showInLibrary": false,
      "allowForking": false
    }
  }
}
```

## Naming style

Use **camelCase** for field names:

```json
{
  "parentLocationId": "location_hollowmere",
  "importantFacts": [],
  "timeWeather": {}
}
```

Do not mix styles such as `parent_location_id`, `ParentLocationId`, and `parent-location-id` for the same concept.

## Arrays, objects, strings, numbers, booleans and null

Use an array when there can be several entries:

```json
{
  "aliases": ["Old Market", "Mist Town"]
}
```

Use an object when a value has named subfields:

```json
{
  "identity": {
    "name": "Hollowmere",
    "description": "A misty market settlement."
  }
}
```

Use real booleans and numbers instead of quoted substitutes:

```json
{
  "isCapital": true,
  "population": 427
}
```

Prefer these meanings for empty values:

- `""` = a text field exists but has no text yet.
- `[]` = a collection exists but currently has no entries.
- `{}` = a structured section exists but currently has no properties.
- `null` = the value is deliberately unknown or unset where that field permits null.

## Stable IDs and references

When one structured entry refers to another, keep a stable machine ID rather than relying only on a display name. Names may be edited later; IDs are what allow relationships to survive renaming.

Example:

```json
{
  "id": "hollowmere-market",
  "name": "Market Square",
  "parentLocationId": "hollowmere"
}
```

Do not change an existing ID merely because the visible name changed.

## Coda's authoring boundary

When Coda is used from an open Orbis editor, the open record is the scope. The record metadata tells Coda its record ID, record type, name and World relationship. Coda may draft changes for that record, but the draft is not a database write.

The expected workflow is:

`Open file → ask Coda → load/review draft → edit if needed → Save`

Coda must not claim that a draft has been saved. Orbis's normal Save action remains authoritative.

## Import behavior

**Create World → Import JSON** validates the text before creating anything. A successful preview shows the detected format, World name and counts for common World sections. The creator must then explicitly press **Create world from JSON**.

For safety, imported authoring Worlds are created as private regardless of any public visibility values present in the file. Review **World Settings** after creation if you want different visibility.

The World JSON importer accepts these authoring-oriented shapes:

- `orbis-authoring` schema version 1.
- A single Orbis World record object containing `type: "world"` and `document`.
- Legacy `hw-world-backup` version 1 World data.
- A raw World document whose root contains `identity`.

## Transfer archives are different

A file with:

```json
{
  "format": "orbis-transfer"
}
```

is a full transfer archive, not a World authoring draft. Use **Account → Upload archive** for that file. Transfer archives preserve linked records, permanent UUIDs and SPC registry identities and therefore must use the transactional transfer importer instead of being flattened into a new World draft.

## Common invalid JSON mistakes

Invalid comments:

```text
{
  // comments are not valid in strict JSON
  "name": "Hollowmere"
}
```

Invalid trailing comma:

```text
{
  "name": "Hollowmere",
}
```

Invalid unquoted string:

```text
{
  "name": Hollowmere
}
```

Correct strict JSON:

```json
{
  "name": "Hollowmere"
}
```

## Keep the schema predictable

Do not invent a new top-level shape every time you write a file. Begin with Orbis's blank template and fill it in. New fields should be added intentionally as the Orbis schema evolves, not because one author happened to spell or arrange a concept differently.
