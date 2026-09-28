-- Discord Coda shared-provider rotation pool.
--
-- This table deliberately stores NO credential material. `user_provider_settings`
-- remains the single authoritative place an encrypted NovelAI credential is
-- stored, and this table only references that row. A member row therefore
-- cannot outlive or invent a provider connection, and there is no second copy
-- of anyone's key to protect, rotate, or leak.
--
-- Everything here is rotation metadata: consent, availability, health, and
-- fairness state for the Discord Coda workload specifically.
--
-- Consent is explicit and off by default. Connecting a NovelAI key to Orbis
-- never enrols it in this pool; an owner must opt in, and may revoke at any
-- time without touching their personal provider configuration.
CREATE TABLE IF NOT EXISTS coda_shared_key_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- References the existing authoritative provider row. ON DELETE CASCADE means
  -- deleting a personal provider setting also withdraws pool membership.
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'novelai' CHECK (provider = 'novelai'),
  -- Explicit owner consent. Defaults to false: no implicit enrolment.
  owner_opt_in boolean NOT NULL DEFAULT false,
  -- Operational switch, separate from consent so an operator can pause the
  -- pool without rewriting anyone's consent.
  enabled boolean NOT NULL DEFAULT true,
  -- What we have learned about this member's ability to serve the Discord Coda
  -- workload. "Has a NovelAI key" is NOT evidence of entitlement: a member is
  -- marked ineligible when the provider reports a tier/entitlement rejection.
  entitled boolean NOT NULL DEFAULT true,
  -- The model this member is known to be entitled to. NULL means unknown, and
  -- the member is then tried. Recorded on both success and denial so a later
  -- request can skip a member already known not to serve this model.
  entitled_model text,
  revoked_at timestamptz,
  last_used_at timestamptz,
  cooldown_until timestamptz,
  last_failure_class text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, provider) REFERENCES user_provider_settings (user_id, provider) ON DELETE CASCADE,
  UNIQUE (user_id, provider)
);

COMMENT ON TABLE coda_shared_key_members IS
  'Rotation metadata for the Discord Coda shared-provider pool. Contains no credential material; the encrypted NovelAI credential stays in user_provider_settings.';
COMMENT ON COLUMN coda_shared_key_members.owner_opt_in IS
  'Explicit owner consent to serve other Discord users. Default false. Never implied by connecting a provider key.';
COMMENT ON COLUMN coda_shared_key_members.entitled IS
  'Whether this member can serve the Discord Coda workload. Cleared on a provider entitlement or credential rejection.';
COMMENT ON COLUMN coda_shared_key_members.entitled_model IS
  'Model this member is known to be entitled to, or NULL when unknown. Learned from provider responses.';

-- Selector reads eligible members in least-recently-used order, so this index
-- matches the query shape directly.
CREATE INDEX IF NOT EXISTS coda_shared_key_members_eligible_idx
  ON coda_shared_key_members (provider, entitled, cooldown_until, last_used_at)
  WHERE owner_opt_in AND enabled AND revoked_at IS NULL;

-- Fixed-window per-Discord-user request counter for the Discord Coda bridge.
-- Kept in the database rather than in process memory so a restart does not hand
-- every user a fresh allowance.
CREATE TABLE IF NOT EXISTS coda_discord_rate_limits (
  discord_user_id text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE coda_discord_rate_limits IS
  'Fixed-window request counter per Discord user for Discord Coda. Durable across restarts.';
