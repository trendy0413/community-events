import type { ColumnType, Generated } from 'kysely';

// Table types for Kysely. They mirror migrations/*.sql; the migrations are the
// source of truth for constraints, these only describe the column shapes.

// The last three are the supply flow's (SPEC section 14).
export const ROLES = ['organizer', 'attendee', 'admin', 'supplier', 'contractor', 'driver'] as const;
export type Role = (typeof ROLES)[number];

export type RegistrationStatus = 'active' | 'cancelled';
export type OrderStatus = 'booked' | 'claimed' | 'delivered' | 'cancelled';

// timestamptz comes back as a Date; inserts may pass a Date or an ISO string.
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type DefaultTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  name: string;
  roles: Role[];
  created_at: DefaultTimestamp;
}

export interface EventsTable {
  id: Generated<string>;
  organizer_id: string;
  title: string;
  description: string | null;
  starts_at: Timestamp;
  timezone: string;
  capacity: number;
  registered_count: Generated<number>;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface RegistrationsTable {
  id: Generated<string>;
  event_id: string;
  attendee_id: string;
  status: Generated<RegistrationStatus>;
  created_at: DefaultTimestamp;
  cancelled_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface DeliverySlotsTable {
  id: Generated<string>;
  supplier_id: string;
  title: string;
  area: string;
  starts_at: Timestamp;
  timezone: string;
  capacity: number;
  booked_count: Generated<number>;
  created_at: DefaultTimestamp;
}

export interface OrdersTable {
  /** Chosen by the client (SPEC S2). */
  id: string;
  slot_id: string;
  contractor_id: string;
  items: string;
  jobsite: string;
  status: Generated<OrderStatus>;
  driver_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: DefaultTimestamp;
  claimed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  delivered_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  cancelled_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface Database {
  users: UsersTable;
  events: EventsTable;
  registrations: RegistrationsTable;
  delivery_slots: DeliverySlotsTable;
  orders: OrdersTable;
}
