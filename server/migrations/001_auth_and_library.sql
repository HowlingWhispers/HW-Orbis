CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  discord_id text NOT NULL UNIQUE,
  discord_username text NOT NULL,
  discord_global_name text,
  display_name text NOT NULL,
  display_name_customized boolean NOT NULL DEFAULT false,
  avatar_url text,
  avatar_decoration_url text,
  banner_hash text,
  accent_color integer,
  collectibles jsonb,
  primary_guild jsonb,
  is_guild_member boolean NOT NULL DEFAULT false,
  can_view_adult boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  access_checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library_assets (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('world','character','place','item','faction','species','society','family','memory')),
  name text NOT NULL,
  summary text NOT NULL DEFAULT '',
  origin_world_id uuid REFERENCES library_assets(id) ON DELETE SET NULL,
  creator_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  source_type text NOT NULL DEFAULT 'user-created',
  content_rating text NOT NULL DEFAULT 'sfw' CHECK (content_rating IN ('sfw','adult')),
  tags text[] NOT NULL DEFAULT '{}',
  dependency_count integer NOT NULL DEFAULT 0,
  pinned boolean NOT NULL DEFAULT false,
  visual_tone text NOT NULL DEFAULT 'moon' CHECK (visual_tone IN ('moon','forest','ember','mist','violet','river')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_assets_visibility_idx ON library_assets (content_rating, updated_at DESC);
CREATE INDEX IF NOT EXISTS library_assets_creator_idx ON library_assets (creator_user_id);
