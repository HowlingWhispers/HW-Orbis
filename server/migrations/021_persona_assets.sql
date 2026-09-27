ALTER TABLE library_assets
  DROP CONSTRAINT IF EXISTS library_assets_type_check;

ALTER TABLE library_assets
  ADD CONSTRAINT library_assets_type_check
  CHECK (type IN ('world','persona','character','place','item','faction','species','society','family','memory'));

-- Persona is a reusable player identity, distinct from both world Characters and
-- runtime instance state. Give it a permanent first-class SPC catalogue identity.
CREATE OR REPLACE FUNCTION speculus_catalog_class(p_asset_type text, p_document jsonb)
RETURNS TABLE(prefix text, classification text)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  kind text := lower(COALESCE(p_document->>'kind', ''));
BEGIN
  CASE lower(p_asset_type)
    WHEN 'persona' THEN RETURN QUERY SELECT 'A', 'PERSONA';
    WHEN 'character' THEN RETURN QUERY SELECT 'C', 'CHARACTER';
    WHEN 'world' THEN RETURN QUERY SELECT 'W', 'WORLD';
    WHEN 'item' THEN RETURN QUERY SELECT 'I', 'ITEM';
    WHEN 'faction' THEN RETURN QUERY SELECT 'F', 'FACTION';
    WHEN 'species' THEN RETURN QUERY SELECT 'S', 'SPECIES';
    WHEN 'society' THEN RETURN QUERY SELECT 'G', 'SOCIETY';
    WHEN 'family' THEN RETURN QUERY SELECT 'H', 'FAMILY / HOUSEHOLD';
    WHEN 'memory' THEN RETURN QUERY SELECT 'M', 'MEMORY / EVENT';
    WHEN 'place' THEN
      IF kind ~ '(town|settlement|village|city|hamlet|enclave)' THEN
        RETURN QUERY SELECT 'T', 'TOWN / SETTLEMENT';
      ELSIF kind ~ '(building|structure|station|house|hall|temple|fort|castle)' THEN
        RETURN QUERY SELECT 'B', 'BUILDING / STRUCTURE';
      ELSE
        RETURN QUERY SELECT 'P', 'PLACE';
      END IF;
    ELSE RETURN QUERY SELECT 'X', 'OTHER';
  END CASE;
END;
$$;
