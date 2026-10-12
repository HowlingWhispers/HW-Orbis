-- Orbis remains the identity authority. Ember never receives the Orbis session cookie.
CREATE TABLE IF NOT EXISTS ember_launch_tickets (
 id uuid PRIMARY KEY,
 token_hash text NOT NULL UNIQUE,
 orbis_session_id text NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 asset_id uuid NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
 mode text NOT NULL CHECK (mode IN ('character','world')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 session_expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ember_launch_tickets_session_idx ON ember_launch_tickets (orbis_session_id, session_expires_at);
CREATE INDEX IF NOT EXISTS ember_launch_tickets_expiration_idx ON ember_launch_tickets (session_expires_at);
-- Operator cleanup: DELETE FROM ember_launch_tickets WHERE session_expires_at < now();
