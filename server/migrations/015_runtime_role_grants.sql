-- Permanent runtime grants for tables introduced after the original database role was created.
-- Production already received an emergency Coda sequence grant; keep the repository
-- authoritative so fresh deployments and restores do not regress.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbis') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE world_brain_revisions, world_brain_bindings
      TO orbis;

    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE coda_discord_messages, coda_control_state, coda_message_templates, coda_scheduled_messages
      TO orbis;

    GRANT USAGE, SELECT
      ON SEQUENCE coda_discord_messages_id_seq, coda_message_templates_id_seq, coda_scheduled_messages_id_seq
      TO orbis;
  END IF;
END
$$;
