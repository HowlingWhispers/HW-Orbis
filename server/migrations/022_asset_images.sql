-- Cover and gallery artwork for every Orbis record type.
-- Binary image data never enters PostgreSQL: Orbis stores the file on disk and
-- keeps only the relative path plus display metadata here. Serving therefore
-- goes through an access-checked route, never a public static directory.
CREATE TABLE IF NOT EXISTS library_asset_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'gallery' CHECK (kind IN ('cover','gallery')),
  storage_kind text NOT NULL DEFAULT 'local' CHECK (storage_kind IN ('local','external')),
  -- Relative path beneath the Orbis media root. Null for external URLs.
  storage_path text,
  external_url text,
  file_name text,
  mime_type text NOT NULL,
  byte_size integer NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  caption text,
  alt_text text,
  -- Focal point as a 0..1 fraction of the image box, so responsive 16:9 card
  -- crops can keep faces and subjects inside the visible frame.
  focal_x numeric(6,5) NOT NULL DEFAULT 0.5 CHECK (focal_x >= 0 AND focal_x <= 1),
  focal_y numeric(6,5) NOT NULL DEFAULT 0.5 CHECK (focal_y >= 0 AND focal_y <= 1),
  position integer NOT NULL DEFAULT 0,
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT library_asset_images_local_source CHECK (
    (storage_kind = 'local' AND storage_path IS NOT NULL AND external_url IS NULL)
    OR (storage_kind = 'external' AND external_url IS NOT NULL AND storage_path IS NULL)
  )
);

-- A record has at most one cover; it is promoted out of the gallery rather than
-- duplicated, so card artwork and the detail hero can never disagree.
CREATE UNIQUE INDEX IF NOT EXISTS library_asset_images_cover_idx
  ON library_asset_images (asset_id)
  WHERE kind = 'cover';

CREATE INDEX IF NOT EXISTS library_asset_images_gallery_order_idx
  ON library_asset_images (asset_id, position, created_at)
  WHERE kind = 'gallery';

CREATE INDEX IF NOT EXISTS library_asset_images_asset_idx
  ON library_asset_images (asset_id);

COMMENT ON COLUMN library_asset_images.focal_x IS
  'Horizontal focal point as a 0..1 fraction of the image width. Applied to CSS object-position so responsive card crops never stretch or hide the subject.';
COMMENT ON COLUMN library_asset_images.storage_path IS
  'Path relative to the Orbis media root. Files are served only through the access-checked Orbis media route.';

-- Super-admin recovery view preference. This is a display filter for the admin
-- session only: it never alters ownership, privacy, permissions or publication
-- state. Default ON so the normal Worlds/library view shows only the admin's
-- own private worlds until the toggle is explicitly turned off.
CREATE TABLE IF NOT EXISTS admin_view_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hide_private_user_worlds boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
