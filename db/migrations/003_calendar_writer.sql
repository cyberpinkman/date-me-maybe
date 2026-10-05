-- A deployment can run the previous application after schema migration and
-- before promotion. Those writers do not maintain calendar reservations.
-- The migrator installs this guard in the same locked transaction as backfill.
CREATE FUNCTION enforce_calendar_invitation_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('opendater.calendar_writer', true) IS DISTINCT FROM 'v1' THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Calendar-aware invitation writer required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER calendar_invitation_writer BEFORE INSERT OR UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION enforce_calendar_invitation_writer();
