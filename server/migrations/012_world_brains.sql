-- Immutable World Brain revisions and per-world effective binding.
-- A world without a binding uses the maintained Standard brain fallback.
CREATE TABLE IF NOT EXISTS world_brain_revisions (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('standard', 'custom')),
  world_id uuid REFERENCES library_assets(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 1000000),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'standard' AND world_id IS NULL)
    OR (kind = 'custom' AND world_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS world_brain_standard_revision_number_idx
  ON world_brain_revisions (revision_number)
  WHERE kind = 'standard';

CREATE UNIQUE INDEX IF NOT EXISTS world_brain_custom_revision_number_idx
  ON world_brain_revisions (world_id, revision_number)
  WHERE kind = 'custom';

CREATE TABLE IF NOT EXISTS world_brain_bindings (
  world_id uuid PRIMARY KEY REFERENCES library_assets(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'standard' CHECK (mode IN ('standard', 'custom')),
  revision_id uuid REFERENCES world_brain_revisions(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (mode = 'standard' AND revision_id IS NULL)
    OR (mode = 'custom' AND revision_id IS NOT NULL)
  )
);
