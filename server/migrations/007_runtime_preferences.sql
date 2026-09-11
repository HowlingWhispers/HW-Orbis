ALTER TABLE users
  ADD COLUMN IF NOT EXISTS player_pronouns text,
  ADD COLUMN IF NOT EXISTS response_length_mode text NOT NULL DEFAULT 'adaptive';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_player_pronouns_check;
ALTER TABLE users ADD CONSTRAINT users_player_pronouns_check
  CHECK (player_pronouns IS NULL OR player_pronouns IN ('he/him','she/her','they/them','it/its'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_response_length_mode_check;
ALTER TABLE users ADD CONSTRAINT users_response_length_mode_check
  CHECK (response_length_mode IN ('concise','normal','long','adaptive'));
