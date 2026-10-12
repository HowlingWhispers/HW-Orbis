-- Add package-free, account-scoped Ember sessions.
-- Asset-based launches keep their existing foreign key and permission checks.
ALTER TABLE ember_launch_tickets ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE ember_launch_tickets DROP CONSTRAINT IF EXISTS ember_launch_tickets_mode_check;
ALTER TABLE ember_launch_tickets ADD CONSTRAINT ember_launch_tickets_mode_check
  CHECK (mode IN ('character','world','sandbox'));
ALTER TABLE ember_launch_tickets ADD CONSTRAINT ember_launch_tickets_sandbox_asset_check
  CHECK ((mode = 'sandbox' AND asset_id IS NULL) OR
         (mode IN ('character','world') AND asset_id IS NOT NULL));
