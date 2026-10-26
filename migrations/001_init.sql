-- Schema for SPEC section 5. Add-only: change it with a new migration file.

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  name        text NOT NULL,
  roles       text[] NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_roles_valid CHECK (
    cardinality(roles) > 0 AND roles <@ ARRAY['organizer', 'attendee', 'admin']::text[]
  )
);

-- Emails differ only by case for the same person.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

CREATE TABLE events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id      uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  title             text NOT NULL,
  description       text,
  starts_at         timestamptz NOT NULL,
  timezone          text NOT NULL,
  capacity          integer NOT NULL,
  registered_count  integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_capacity_positive CHECK (capacity > 0),
  -- R1 backstop: even code that forgets the conditional UPDATE guard cannot
  -- store more registrations than seats.
  CONSTRAINT events_registered_count_within_capacity CHECK (registered_count BETWEEN 0 AND capacity)
);

CREATE INDEX events_starts_at_idx ON events (starts_at);
CREATE INDEX events_organizer_id_idx ON events (organizer_id);

CREATE TABLE registrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: deleting an event or a user must never remove registrations
  -- behind the registration service, which keeps registered_count.
  event_id      uuid NOT NULL REFERENCES events (id) ON DELETE RESTRICT,
  attendee_id   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  CONSTRAINT registrations_status_valid CHECK (status IN ('active', 'cancelled')),
  CONSTRAINT registrations_cancelled_at_matches_status CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

-- R2: one active registration per person per event. Partial, so a cancelled
-- row stays as history and the person can register again.
CREATE UNIQUE INDEX registrations_one_active_per_attendee
  ON registrations (event_id, attendee_id)
  WHERE status = 'active';

CREATE INDEX registrations_attendee_id_idx ON registrations (attendee_id, created_at DESC);

-- Registrations are history: they are cancelled, never deleted. A row delete
-- would change the real seat count without touching registered_count.
-- (TRUNCATE does not fire row triggers; only the demo reset and the test
-- setup use it, and both empty every table at once.)
CREATE FUNCTION forbid_registration_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'registrations are never deleted; cancel them instead'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER registrations_no_delete
  BEFORE DELETE ON registrations
  FOR EACH ROW EXECUTE FUNCTION forbid_registration_delete();
