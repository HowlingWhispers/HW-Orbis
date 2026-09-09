CREATE TABLE IF NOT EXISTS speculus_catalog_sequences (
  prefix text PRIMARY KEY CHECK (prefix ~ '^[A-Z]$'),
  next_ordinal bigint NOT NULL DEFAULT 1 CHECK (next_ordinal > 0)
);

CREATE TABLE IF NOT EXISTS speculus_catalog_registry (
  asset_id uuid PRIMARY KEY,
  prefix text NOT NULL CHECK (prefix ~ '^[A-Z]$'),
  ordinal bigint NOT NULL CHECK (ordinal > 0),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  series text NOT NULL CHECK (series ~ '^[A-Z]{2}$'),
  number integer NOT NULL CHECK (number BETWEEN 1 AND 99999),
  code text NOT NULL UNIQUE,
  classification text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'retired', 'sealed')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (prefix, ordinal)
);

CREATE INDEX IF NOT EXISTS speculus_catalog_registry_status_idx
  ON speculus_catalog_registry (status, prefix, ordinal);

CREATE OR REPLACE FUNCTION speculus_catalog_class(p_asset_type text, p_document jsonb)
RETURNS TABLE(prefix text, classification text)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  kind text := lower(COALESCE(p_document->>'kind', ''));
BEGIN
  CASE lower(p_asset_type)
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

CREATE OR REPLACE FUNCTION ensure_speculus_catalog_entry(
  p_asset_id uuid,
  p_asset_type text,
  p_document jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  code text,
  prefix text,
  generation integer,
  series text,
  number integer,
  classification text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix text;
  v_classification text;
  v_ordinal bigint;
  v_generation integer;
  v_within_generation bigint;
  v_series_index integer;
  v_series text;
  v_number integer;
  v_code text;
  v_capacity constant bigint := 67599324; -- 26 * 26 * 99,999
BEGIN
  -- One asset can only ever receive one SPC designation.
  PERFORM pg_advisory_xact_lock(hashtext(p_asset_id::text));

  RETURN QUERY
    SELECT r.code, r.prefix, r.generation, r.series, r.number, r.classification
    FROM speculus_catalog_registry r
    WHERE r.asset_id = p_asset_id;
  IF FOUND THEN RETURN; END IF;

  SELECT c.prefix, c.classification
    INTO v_prefix, v_classification
    FROM speculus_catalog_class(p_asset_type, COALESCE(p_document, '{}'::jsonb)) c;

  INSERT INTO speculus_catalog_sequences (prefix, next_ordinal)
    VALUES (v_prefix, 2)
  ON CONFLICT (prefix) DO UPDATE
    SET next_ordinal = speculus_catalog_sequences.next_ordinal + 1
  RETURNING next_ordinal - 1 INTO v_ordinal;

  v_generation := ((v_ordinal - 1) / v_capacity)::integer + 1;
  v_within_generation := (v_ordinal - 1) % v_capacity;
  v_series_index := (v_within_generation / 99999)::integer;
  v_number := (v_within_generation % 99999)::integer + 1;
  v_series := chr(65 + (v_series_index / 26)) || chr(65 + (v_series_index % 26));

  IF v_generation = 1 THEN
    v_code := 'SPC-' || v_prefix || '-' || v_series || lpad(v_number::text, 5, '0');
  ELSE
    v_code := 'SPC#' || v_generation || '-' || v_prefix || '-' || v_series || lpad(v_number::text, 5, '0');
  END IF;

  INSERT INTO speculus_catalog_registry (
    asset_id, prefix, ordinal, generation, series, number, code, classification
  ) VALUES (
    p_asset_id, v_prefix, v_ordinal, v_generation, v_series, v_number, v_code, v_classification
  );

  RETURN QUERY
    SELECT r.code, r.prefix, r.generation, r.series, r.number, r.classification
    FROM speculus_catalog_registry r
    WHERE r.asset_id = p_asset_id;
END;
$$;

-- Give every existing Orbis asset a permanent designation. Ragna and Pip seed
-- the character catalogue as C-AA00001 and C-AA00002 when they are present.
DO $$
DECLARE
  asset record;
BEGIN
  FOR asset IN
    SELECT id, type, document
    FROM library_assets
    ORDER BY
      CASE
        WHEN type = 'character' AND document->>'sourceId' = 'ragna-holt' THEN 0
        WHEN type = 'character' AND document->>'sourceId' = 'pip-holt' THEN 1
        ELSE 2
      END,
      created_at,
      name,
      id
  LOOP
    PERFORM ensure_speculus_catalog_entry(asset.id, asset.type, asset.document);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION assign_speculus_catalog_on_asset_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM ensure_speculus_catalog_entry(NEW.id, NEW.type, NEW.document);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS library_assets_assign_speculus_catalog ON library_assets;
CREATE TRIGGER library_assets_assign_speculus_catalog
AFTER INSERT ON library_assets
FOR EACH ROW
EXECUTE FUNCTION assign_speculus_catalog_on_asset_insert();

CREATE OR REPLACE FUNCTION retire_speculus_catalog_on_asset_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE speculus_catalog_registry
  SET status = 'retired', retired_at = COALESCE(retired_at, now())
  WHERE asset_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS library_assets_retire_speculus_catalog ON library_assets;
CREATE TRIGGER library_assets_retire_speculus_catalog
BEFORE DELETE ON library_assets
FOR EACH ROW
EXECUTE FUNCTION retire_speculus_catalog_on_asset_delete();
