ALTER TABLE speculus_saves
  ADD COLUMN IF NOT EXISTS simulation_day integer NOT NULL DEFAULT 1 CHECK (simulation_day >= 1);
