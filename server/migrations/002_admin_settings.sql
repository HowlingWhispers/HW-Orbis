ALTER TABLE users ADD COLUMN IF NOT EXISTS can_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key text PRIMARY KEY,
  setting_value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admin_setting_audit (
  id bigserial PRIMARY KEY,
  setting_key text NOT NULL,
  previous_value jsonb,
  new_value jsonb NOT NULL,
  changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_setting_audit_changed_at_idx
  ON admin_setting_audit (changed_at DESC);

CREATE INDEX IF NOT EXISTS admin_setting_audit_actor_idx
  ON admin_setting_audit (changed_by_user_id, changed_at DESC);
