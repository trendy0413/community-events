import type { ColumnType, Generated } from 'kysely';

// Table types for Kysely. They mirror migrations/*.sql; the migrations are the
// source of truth for constraints, these only describe the column shapes.

export const ROLES = ['organizer', 'attendee', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export type RegistrationStatus = 'active' | 'cancelled';

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

export interface Database {
  users: UsersTable;
  events: EventsTable;
  registrations: RegistrationsTable;
}
