-- Migration: Promote embedded world locations to linked library place assets
-- Run with: sudo -u postgres psql -d orbis -f migrate-world-locations.sql

CREATE OR REPLACE FUNCTION migrate_world_locations()
RETURNS VOID AS $migrate$
DECLARE
    world_rec RECORD;
    loc_elem JSONB;
    place_id UUID;
    place_doc JSONB;
    migrated_count INTEGER := 0;
    error_count INTEGER := 0;
BEGIN
    FOR world_rec IN SELECT id, name FROM library_assets WHERE type = 'world' LOOP
        RAISE NOTICE 'Processing world: % (%)', world_rec.name, world_rec.id;
        
        FOR loc_elem IN SELECT jsonb_array_elements(document->'locations') FROM library_assets WHERE id = world_rec.id LOOP
            IF loc_elem ? 'id' AND loc_elem ? 'name' THEN
                place_id := NULLIF(loc_elem->>'libraryAssetId', '')::UUID;
                place_doc := jsonb_build_object(
                    'kind', COALESCE(loc_elem->>'kind', 'region'),
                    'parentLocationId', COALESCE(loc_elem->>'parentLocationId', '')::UUID,
                    'description', COALESCE(loc_elem->>'description', '')
                );
                
                BEGIN
                    IF place_id IS NOT NULL THEN
                        IF NOT EXISTS (SELECT 1 FROM library_assets WHERE id = place_id AND type = 'place' AND origin_world_id = world_rec.id) THEN
                            RAISE NOTICE '  Location "%" (%) references missing place asset %; creating new', loc_elem->>'name', loc_elem->>'id', place_id;
                            place_id := NULL;
                        END IF;
                    END IF;
                    
                    IF place_id IS NULL THEN
                        place_id := gen_random_uuid();
                        INSERT INTO library_assets (id, type, name, summary, origin_world_id, creator_user_id, source_type, content_rating, tags, visual_tone, document)
                        VALUES (place_id, 'place', loc_elem->>'name', COALESCE(loc_elem->>'description', ''), world_rec.id, 
                                (SELECT creator_user_id FROM library_assets WHERE id = world_rec.id),
                                'user-created', 'sfw', '{}', 'mist', place_doc)
                        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, summary = EXCLUDED.summary, document = EXCLUDED.document, updated_at = now();
                        RAISE NOTICE '  Created place asset % for location "%"', place_id, loc_elem->>'name';
                        migrated_count := migrated_count + 1;
                    ELSE
                        UPDATE library_assets 
                        SET name = loc_elem->>'name', 
                            summary = COALESCE(loc_elem->>'description', ''), 
                            document = place_doc, 
                            updated_at = now()
                        WHERE id = place_id;
                    END IF;
                    
                    IF (loc_elem->>'libraryAssetId') IS DISTINCT FROM place_id::TEXT THEN
                        UPDATE library_assets 
                        SET document = jsonb_set(document, '{locations}', (
                            SELECT jsonb_agg(
                                CASE WHEN item->>'id' = (loc_elem->>'id') 
                                THEN jsonb_set(item, '{libraryAssetId}', to_jsonb(place_id::TEXT)) 
                                ELSE item END
                            ) FROM jsonb_array_elements(document->'locations') AS item
                        )
                        WHERE id = world_rec.id;
                    END IF;
                    
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE '  ERROR for location "%" (%): %', loc_elem->>'name', loc_elem->>'id', SQLERRM;
                    error_count := error_count + 1;
                END;
            ELSE
                RAISE NOTICE '  Skipping invalid location: missing id or name';
            END IF;
        END LOOP;
        
        RAISE NOTICE 'World % done', world_rec.name;
    END LOOP;
    
    RAISE NOTICE '=== Migration complete ===';
    RAISE NOTICE 'Total locations migrated: %', migrated_count;
    RAISE NOTICE 'Total errors: %', error_count;
END;
$migrate$ LANGUAGE plpgsql;

SELECT migrate_world_locations();