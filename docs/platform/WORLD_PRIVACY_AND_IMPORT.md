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

## Browser transfer archives

Orbis owners can download a versioned `.orbis.json` transfer archive from every SPC record. A world download includes the world root and every record owned by the same account inside that world. The Account page also provides **Download everything** and **Upload archive** controls.

Transfer archives contain authored library records, world links, timestamps, source identities and permanent SPC registry identities. They never include Discord access tokens, provider credentials, cookies, sessions or password material. Every archive has a SHA-256 checksum for accidental corruption detection, and uploads are rejected if the package has changed or is malformed.

Imports retain record UUIDs and SPC codes, assign ownership to the signed-in importing account, reject target conflicts, and run in one database transaction. A failed validation or insert rolls the entire import back. This transfer path is intended for user backups and server migration, but it does not replace a separately tested PostgreSQL backup.

Transfer archives are not encrypted. Store private-world exports in protected storage or an encrypted private backup repository. Never commit an unencrypted transfer archive to public Git.
