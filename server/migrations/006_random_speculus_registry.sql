BEGIN;

CREATE TABLE IF NOT EXISTS speculus_catalog_reserved_plates (
  plate text PRIMARY KEY CHECK (plate ~ '^[A-Z]{2}[0-9]{5}$'),
  reason text NOT NULL DEFAULT '',
  reserved_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO speculus_catalog_reserved_plates (plate, reason)
VALUES ('AA68696', 'Reserved founder plate')
ON CONFLICT (plate) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS speculus_catalog_global_seq START WITH 1;

ALTER TABLE speculus_catalog_registry
  ADD COLUMN IF NOT EXISTS registry_number bigint,
  ADD COLUMN IF NOT EXISTS plate text,
  ADD COLUMN IF NOT EXISTS asset_created_at timestamptz;

UPDATE speculus_catalog_registry r
SET asset_created_at = COALESCE(a.created_at, r.assigned_at)
FROM library_assets a
WHERE r.asset_id = a.id
  AND r.asset_created_at IS NULL;

UPDATE speculus_catalog_registry
SET asset_created_at = assigned_at
WHERE asset_created_at IS NULL;

WITH ordered AS (
  SELECT asset_id,
         row_number() OVER (
           ORDER BY asset_created_at, assigned_at, prefix, ordinal, asset_id
         )::bigint AS registry_number
  FROM speculus_catalog_registry
)
UPDATE speculus_catalog_registry r
SET registry_number = ordered.registry_number
FROM ordered
WHERE r.asset_id = ordered.asset_id
  AND r.registry_number IS NULL;

DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT max(registry_number) INTO v_max FROM speculus_catalog_registry;
  IF v_max IS NULL THEN
    PERFORM setval('speculus_catalog_global_seq', 1, false);
  ELSE
    PERFORM setval('speculus_catalog_global_seq', v_max, true);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS speculus_catalog_registry_number_idx
  ON speculus_catalog_registry (registry_number);

CREATE UNIQUE INDEX IF NOT EXISTS speculus_catalog_registry_plate_generation_idx
  ON speculus_catalog_registry (generation, plate)
  WHERE plate IS NOT NULL;

CREATE INDEX IF NOT EXISTS speculus_catalog_registry_created_idx
  ON speculus_catalog_registry (asset_created_at, registry_number);

CREATE OR REPLACE FUNCTION speculus_random_plate_candidate()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT
    chr(65 + floor(random() * 26)::integer) ||
    chr(65 + floor(random() * 26)::integer) ||
    lpad((floor(random() * 99999)::integer + 1)::text, 5, '0');
$$;

CREATE OR REPLACE FUNCTION speculus_issue_random_plate(p_generation integer)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_plate text;
  v_attempt integer;
BEGIN
  FOR v_attempt IN 1..10000 LOOP
    v_plate := speculus_random_plate_candidate();

    IF NOT EXISTS (
      SELECT 1 FROM speculus_catalog_reserved_plates rp WHERE rp.plate = v_plate
    ) AND NOT EXISTS (
      SELECT 1
      FROM speculus_catalog_registry r
      WHERE r.generation = p_generation
        AND r.plate = v_plate
    ) THEN
      RETURN v_plate;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'Speculus could not allocate an unused registry plate for generation %.', p_generation;
END;
$$;

-- Free the old sequential public-code namespace before random conversion. This
-- prevents a freshly generated plate from colliding with an unconverted 005
-- placeholder code. The migration transaction makes this invisible externally.
UPDATE speculus_catalog_registry
SET code = 'MIGRATING-' || asset_id::text
WHERE plate IS NULL;

-- Convert any catalogue entries created by migration 005 to random public plates.
-- Their hidden chronological class sequence (ordinal) stays intact.
DO $$
DECLARE
  r record;
  v_plate text;
  v_capacity bigint;
  v_generation integer;
  v_code text;
BEGIN
  SELECT (26::bigint * 26::bigint * 99999::bigint) - count(*)::bigint
    INTO v_capacity
    FROM speculus_catalog_reserved_plates;

  IF v_capacity <= 0 THEN
    RAISE EXCEPTION 'No Speculus registry plates are available.';
  END IF;

  FOR r IN
    SELECT asset_id, prefix, registry_number
    FROM speculus_catalog_registry
    WHERE plate IS NULL
    ORDER BY registry_number
  LOOP
    v_generation := ((r.registry_number - 1) / v_capacity)::integer + 1;
    v_plate := speculus_issue_random_plate(v_generation);

    IF v_generation = 1 THEN
      v_code := 'SPC-' || r.prefix || '-' || v_plate;
    ELSE
      v_code := 'SPC#' || v_generation || '-' || r.prefix || '-' || v_plate;
    END IF;

    UPDATE speculus_catalog_registry
    SET generation = v_generation,
        plate = v_plate,
        series = left(v_plate, 2),
        number = right(v_plate, 5)::integer,
        code = v_code
    WHERE asset_id = r.asset_id;
  END LOOP;
END;
$$;

ALTER TABLE speculus_catalog_registry
  ALTER COLUMN registry_number SET NOT NULL,
  ALTER COLUMN plate SET NOT NULL,
  ALTER COLUMN asset_created_at SET NOT NULL;

ALTER TABLE speculus_catalog_registry
  DROP CONSTRAINT IF EXISTS speculus_catalog_registry_plate_check;
ALTER TABLE speculus_catalog_registry
  ADD CONSTRAINT speculus_catalog_registry_plate_check
  CHECK (plate ~ '^[A-Z]{2}[0-9]{5}$');

CREATE OR REPLACE FUNCTION ensure_speculus_catalog_entry_v2(
  p_asset_id uuid,
  p_asset_type text,
  p_document jsonb DEFAULT '{}'::jsonb,
  p_asset_created_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  code text,
  prefix text,
  plate text,
  generation integer,
  registry_number bigint,
  class_registry_number bigint,
  classification text,
  asset_created_at timestamptz,
  status text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix text;
  v_classification text;
  v_registry_number bigint;
  v_class_registry_number bigint;
  v_generation integer;
  v_capacity bigint;
  v_plate text;
  v_code text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_asset_id::text));

  RETURN QUERY
    SELECT r.code,
           r.prefix,
           r.plate,
           r.generation,
           r.registry_number,
           r.ordinal,
           r.classification,
           r.asset_created_at,
           r.status
    FROM speculus_catalog_registry r
    WHERE r.asset_id = p_asset_id;
  IF FOUND THEN RETURN; END IF;

  -- Serialize issuance so two new assets cannot claim the same random plate.
  PERFORM pg_advisory_xact_lock(hashtext('speculus-catalog-issuer'));

  -- Re-check after taking the issuer lock in case another transaction created it.
  RETURN QUERY
    SELECT r.code,
           r.prefix,
           r.plate,
           r.generation,
           r.registry_number,
           r.ordinal,
           r.classification,
           r.asset_created_at,
           r.status
    FROM speculus_catalog_registry r
    WHERE r.asset_id = p_asset_id;
  IF FOUND THEN RETURN; END IF;

  SELECT c.prefix, c.classification
    INTO v_prefix, v_classification
    FROM speculus_catalog_class(p_asset_type, COALESCE(p_document, '{}'::jsonb)) c;

  v_registry_number := nextval('speculus_catalog_global_seq');

  INSERT INTO speculus_catalog_sequences (prefix, next_ordinal)
    VALUES (v_prefix, 2)
  ON CONFLICT (prefix) DO UPDATE
    SET next_ordinal = speculus_catalog_sequences.next_ordinal + 1
  RETURNING next_ordinal - 1 INTO v_class_registry_number;

  SELECT (26::bigint * 26::bigint * 99999::bigint) - count(*)::bigint
    INTO v_capacity
    FROM speculus_catalog_reserved_plates;

  IF v_capacity <= 0 THEN
    RAISE EXCEPTION 'No Speculus registry plates are available.';
  END IF;

  v_generation := ((v_registry_number - 1) / v_capacity)::integer + 1;
  v_plate := speculus_issue_random_plate(v_generation);

  IF v_generation = 1 THEN
    v_code := 'SPC-' || v_prefix || '-' || v_plate;
  ELSE
    v_code := 'SPC#' || v_generation || '-' || v_prefix || '-' || v_plate;
  END IF;

  INSERT INTO speculus_catalog_registry (
    asset_id,
    prefix,
    ordinal,
    generation,
    series,
    number,
    plate,
    code,
    classification,
    registry_number,
    asset_created_at
  ) VALUES (
    p_asset_id,
    v_prefix,
    v_class_registry_number,
    v_generation,
    left(v_plate, 2),
    right(v_plate, 5)::integer,
    v_plate,
    v_code,
    v_classification,
    v_registry_number,
    COALESCE(p_asset_created_at, now())
  );

  RETURN QUERY
    SELECT r.code,
           r.prefix,
           r.plate,
           r.generation,
           r.registry_number,
           r.ordinal,
           r.classification,
           r.asset_created_at,
           r.status
    FROM speculus_catalog_registry r
    WHERE r.asset_id = p_asset_id;
END;
$$;

-- Keep the original function signature working for any older Orbis code while
-- routing all new assignments through the random permanent registry.
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
LANGUAGE sql
AS $$
  SELECT v.code,
         v.prefix,
         v.generation,
         left(v.plate, 2) AS series,
         right(v.plate, 5)::integer AS number,
         v.classification
  FROM ensure_speculus_catalog_entry_v2(p_asset_id, p_asset_type, p_document, now()) v;
$$;

CREATE OR REPLACE FUNCTION assign_speculus_catalog_on_asset_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM ensure_speculus_catalog_entry_v2(NEW.id, NEW.type, NEW.document, NEW.created_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS library_assets_assign_speculus_catalog ON library_assets;
CREATE TRIGGER library_assets_assign_speculus_catalog
AFTER INSERT ON library_assets
FOR EACH ROW
EXECUTE FUNCTION assign_speculus_catalog_on_asset_insert();

-- If an installation somehow contains assets without a registry row, backfill
-- them now. Ragna and Pip remain first in the Character class when unassigned.
DO $$
DECLARE
  asset record;
BEGIN
  FOR asset IN
    SELECT a.id, a.type, a.document, a.created_at
    FROM library_assets a
    LEFT JOIN speculus_catalog_registry r ON r.asset_id = a.id
    WHERE r.asset_id IS NULL
    ORDER BY
      CASE
        WHEN a.type = 'character' AND a.document->>'sourceId' = 'ragna-holt' THEN 0
        WHEN a.type = 'character' AND a.document->>'sourceId' = 'pip-holt' THEN 1
        ELSE 2
      END,
      a.created_at,
      a.name,
      a.id
  LOOP
    PERFORM ensure_speculus_catalog_entry_v2(asset.id, asset.type, asset.document, asset.created_at);
  END LOOP;
END;
$$;

COMMIT;
