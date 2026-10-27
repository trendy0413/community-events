-- Jobsite supply (SPEC section 14): delivery slots, orders and delivery jobs.
-- Add-only: change it with a new migration file.

-- The supply roles join the role set.
ALTER TABLE users DROP CONSTRAINT users_roles_valid;
ALTER TABLE users ADD CONSTRAINT users_roles_valid CHECK (
  cardinality(roles) > 0
  AND roles <@ ARRAY['organizer', 'attendee', 'admin', 'supplier', 'contractor', 'driver']::text[]
);

CREATE TABLE delivery_slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  title         text NOT NULL,
  area          text NOT NULL,
  starts_at     timestamptz NOT NULL,
  timezone      text NOT NULL,
  capacity      integer NOT NULL,
  booked_count  integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_slots_capacity_positive CHECK (capacity > 0),
  -- S1 backstop, as for events: code that forgets the guard still cannot
  -- book more deliveries than the slot has.
  CONSTRAINT delivery_slots_booked_within_capacity CHECK (booked_count BETWEEN 0 AND capacity)
);

CREATE INDEX delivery_slots_starts_at_idx ON delivery_slots (starts_at);
CREATE INDEX delivery_slots_supplier_id_idx ON delivery_slots (supplier_id);

CREATE TABLE orders (
  -- Chosen by the client, so a retried request names the same order (S2).
  id             uuid PRIMARY KEY,
  slot_id        uuid NOT NULL REFERENCES delivery_slots (id) ON DELETE RESTRICT,
  contractor_id  uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  items          text NOT NULL,
  jobsite        text NOT NULL,
  status         text NOT NULL DEFAULT 'booked',
  driver_id      uuid REFERENCES users (id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  claimed_at     timestamptz,
  delivered_at   timestamptz,
  cancelled_at   timestamptz,
  CONSTRAINT orders_status_valid CHECK (status IN ('booked', 'claimed', 'delivered', 'cancelled')),
  -- S4 backstop: a job has a driver exactly when it is claimed or delivered.
  CONSTRAINT orders_driver_matches_status CHECK ((status IN ('claimed', 'delivered')) = (driver_id IS NOT NULL)),
  CONSTRAINT orders_claimed_at_matches_status CHECK ((status IN ('claimed', 'delivered')) = (claimed_at IS NOT NULL)),
  CONSTRAINT orders_delivered_at_matches_status CHECK ((status = 'delivered') = (delivered_at IS NOT NULL)),
  CONSTRAINT orders_cancelled_at_matches_status CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE INDEX orders_slot_id_idx ON orders (slot_id);
CREATE INDEX orders_contractor_id_idx ON orders (contractor_id, created_at DESC);
CREATE INDEX orders_driver_id_idx ON orders (driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX orders_open_idx ON orders (slot_id) WHERE status = 'booked';

-- Orders are history, like registrations: a row delete would change the
-- real number of bookings without touching booked_count.
CREATE FUNCTION forbid_order_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'orders are never deleted; cancel them instead'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER orders_no_delete
  BEFORE DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION forbid_order_delete();
