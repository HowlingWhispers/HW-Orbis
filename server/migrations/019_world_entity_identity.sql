-- A display name is not identity. Once a world child has a stable worldEntryId,
-- PostgreSQL itself must reject two canonical rows claiming the same identity.
-- Legacy rows without worldEntryId remain allowed until the one-time repair links them.
CREATE UNIQUE INDEX IF NOT EXISTS library_assets_world_entry_identity_uidx
  ON library_assets (origin_world_id, type, (document->>'worldEntryId'))
  WHERE origin_world_id IS NOT NULL
    AND type IN ('place','species','faction','society','family','memory')
    AND COALESCE(document->>'worldEntryId', '') <> '';
