# World Privacy and Backup Import

This document describes the current Orbis per-world privacy model and the conservative import path for legacy `hw-world-backup` version 1 exports.

## World settings

World settings are stored on the world root document under `worldSettings`.

```json
{
  "worldSettings": {
    "visibility": "private",
    "showInLibrary": false,
    "allowForking": false
  }
}
```

Supported visibility values:

- `public`: discoverable when `showInLibrary` is true.
- `unlisted`: hidden from browse/search but available by direct link.
- `private`: owner-only. Other users receive `404 Record not found` for direct lookup so private world existence is not disclosed.

Existing worlds without `worldSettings` keep the previous behavior and default to public/discoverable.

World-linked assets inherit the root world's privacy. The server applies this to Orbis overview counts, recent/pinned records, browse/search, direct record lookup, and Speculus launch authorization.

The World Forge exposes **World Settings** as the final tab after **Time & Weather**.

## Importing an `hw-world-backup` export

The import command accepts a file path and resolves ownership from an immutable Discord ID. The raw source file is read only and is never committed to the public Orbis repository.

Build first:

```bash
npm run build
```

Run a dry-run first:

```bash
npm run import:world-backup -- \
  --file /protected/path/world.hw-world.json \
  --owner-discord-id DISCORD_ID \
  --visibility private
```

The dry-run validates the package, resolves the Orbis owner account, checks for stable-source-ID conflicts, prints the asset count and source SHA-256, and performs no database writes.

After reviewing the dry-run, apply the import explicitly:

```bash
npm run import:world-backup -- \
  --file /protected/path/world.hw-world.json \
  --owner-discord-id DISCORD_ID \
  --visibility private \
  --apply
```

The applied import is transactional. The world root is inserted first, child records are linked through `origin_world_id`, all records are assigned to the resolved owner account, and any failure rolls the transaction back.

### Safety rules

- No silent merge or overwrite.
- Stable source IDs are preserved through `source_asset_id`.
- Same names are not considered duplicates.
- Existing stable-source-ID conflicts stop the import.
- The original source file remains untouched.
- Private imports are owner-only immediately after insertion.
- The import tool never stores the raw private backup in the public Git repository.
