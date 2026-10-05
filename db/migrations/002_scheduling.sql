CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE user_schedules (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  time_zone text NOT NULL,
  weekly jsonb NOT NULL,
  overrides jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invitation_guest_accounts (
  invitation_id uuid PRIMARY KEY REFERENCES invitations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitation_guest_accounts_user_idx ON invitation_guest_accounts(user_id);
CREATE TABLE calendar_reservations (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  invitation_id uuid REFERENCES invitations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('booking','busy')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  label text NOT NULL DEFAULT '',
  legacy_conflict boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((kind='booking') = (invitation_id IS NOT NULL)),
  UNIQUE (invitation_id,user_id)
);
CREATE INDEX calendar_reservations_user_time_idx ON calendar_reservations(user_id,starts_at,ends_at);
CREATE TABLE calendar_migration_issues (
  invitation_id uuid PRIMARY KEY REFERENCES invitations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE calendar_busy_requests (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,request_id)
);

-- Preserve historical confirmations as real occupied intervals. Existing
-- overlaps must remain visible and blocking rather than disappear on upgrade.
DO $$
DECLARE item record; agreed jsonb; local_start timestamp; instant timestamptz; zone text; duration integer;
BEGIN
  FOR item IN SELECT * FROM invitations
    WHERE COALESCE(state->>'closed','false')='false'
  LOOP
    -- A proposal awaiting fresh consent does not release its prior agreement.
    -- History stores each prior proposal and its approvals before revision.
    SELECT candidate INTO agreed FROM (
      SELECT item.state AS candidate, 2147483647::bigint AS position
      UNION ALL
      SELECT value, ordinality FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(item.state->'history')='array' THEN item.state->'history' ELSE '[]'::jsonb END) WITH ORDINALITY
    ) versions WHERE candidate->'approvals'->>'host'=candidate->>'version'
      AND candidate->'approvals'->>'guest'=candidate->>'version'
      AND COALESCE(candidate->'proposal'->>'date','')<>''
      AND COALESCE(candidate->'proposal'->>'time','')<>''
      AND COALESCE(candidate->'proposal'->>'place','')<>''
      AND (NOT (candidate->'proposal' ? 'activities') OR COALESCE(candidate->'proposal'->>'activity','')<>'')
    ORDER BY position DESC LIMIT 1;
    IF agreed IS NULL THEN CONTINUE; END IF;
    BEGIN
      zone := COALESCE(item.state->>'timeZone','Asia/Shanghai');
      IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone)
        OR NOT COALESCE(agreed->'proposal'->>'date','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
        OR NOT COALESCE(agreed->'proposal'->>'time','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'Unresolved historical time';
      END IF;
      local_start := ((agreed->'proposal'->>'date') || ' ' || (agreed->'proposal'->>'time'))::timestamp;
      instant := local_start AT TIME ZONE zone;
      IF instant AT TIME ZONE zone <> local_start THEN RAISE EXCEPTION 'Nonexistent historical time'; END IF;
      IF (SELECT count(*) FROM generate_series(instant-interval '26 hours',instant+interval '26 hours',interval '15 minutes') candidate
        WHERE candidate AT TIME ZONE zone=local_start) <> 1 THEN RAISE EXCEPTION 'Ambiguous historical time'; END IF;
      duration := COALESCE((item.state->>'durationMinutes')::integer,120);
      IF duration < 30 OR duration > 720 THEN RAISE EXCEPTION 'Invalid historical duration'; END IF;
      INSERT INTO calendar_reservations(id,user_id,invitation_id,kind,starts_at,ends_at)
        VALUES(gen_random_uuid(),item.owner_id,item.id,'booking',instant,instant+duration*interval '1 minute');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO calendar_migration_issues(invitation_id,user_id,reason)
        VALUES(item.id,item.owner_id,'请重新确认这份旧邀约的时间。');
    END;
  END LOOP;
END $$;
UPDATE calendar_reservations a SET legacy_conflict=true
WHERE EXISTS(SELECT 1 FROM calendar_reservations b WHERE a.id<>b.id AND a.user_id=b.user_id
  AND tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(b.starts_at,b.ends_at,'[)'));

-- All new reservations are covered by PostgreSQL's concurrent exclusion
-- guarantee. Legacy overlaps remain read-only exceptions, never a write path.
ALTER TABLE calendar_reservations ADD CONSTRAINT calendar_no_overlap
  EXCLUDE USING gist (user_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
  WHERE (NOT legacy_conflict);
CREATE FUNCTION enforce_calendar_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('calendar:' || NEW.user_id,0));
  IF TG_OP='UPDATE' AND (NEW.user_id,NEW.invitation_id,NEW.kind,NEW.starts_at,NEW.ends_at,NEW.legacy_conflict)
      IS NOT DISTINCT FROM (OLD.user_id,OLD.invitation_id,OLD.kind,OLD.starts_at,OLD.ends_at,OLD.legacy_conflict) THEN
    RETURN NEW;
  END IF;
  IF NEW.legacy_conflict THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Legacy calendar exceptions cannot be created or moved';
  END IF;
  IF EXISTS(SELECT 1 FROM calendar_migration_issues WHERE user_id=NEW.user_id) THEN
    RAISE EXCEPTION USING ERRCODE='23P01', MESSAGE='Resolve historical calendar issues before booking';
  END IF;
  IF EXISTS(SELECT 1 FROM calendar_reservations r WHERE r.user_id=NEW.user_id AND r.id<>NEW.id
    AND tstzrange(r.starts_at,r.ends_at,'[)') && tstzrange(NEW.starts_at,NEW.ends_at,'[)')) THEN
    RAISE EXCEPTION USING ERRCODE='23P01', MESSAGE='Calendar interval overlaps an existing reservation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER calendar_reservation_invariant BEFORE INSERT OR UPDATE ON calendar_reservations
  FOR EACH ROW EXECUTE FUNCTION enforce_calendar_reservation();

REVOKE ALL ON user_schedules,invitation_guest_accounts,calendar_reservations,calendar_migration_issues,calendar_busy_requests FROM PUBLIC;
