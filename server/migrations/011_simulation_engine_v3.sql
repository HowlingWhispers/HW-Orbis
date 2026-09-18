-- Extend the account-level Speculus engine preference with V3.
-- V3 currently reuses the V2 bridge contract but launches the isolated /v3 client runtime.
ALTER TABLE user_simulation_settings
  DROP CONSTRAINT IF EXISTS user_simulation_settings_engine_check;

ALTER TABLE user_simulation_settings
  ADD CONSTRAINT user_simulation_settings_engine_check
  CHECK (engine IN ('v1', 'v2', 'v3'));
