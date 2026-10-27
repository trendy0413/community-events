import { type Kysely, type Selectable, sql, type Transaction } from 'kysely';
import type { Database, RegistrationsTable } from '../../db/schema.js';

// The SQL behind SPEC section 8. Every write runs inside a transaction that
// the registration service opens. These are the only queries that change
// events.registered_count.

type Trx = Transaction<Database>;
type RegistrationRow = Selectable<RegistrationsTable>;

export interface Registration {
  id: string;
  eventId: string;
  attendeeId: string;
  status: 'active' | 'cancelled';
  createdAt: Date;
  cancelledAt: Date | null;
}

function toRegistration(row: RegistrationRow): Registration {
  return {
    id: row.id,
    eventId: row.event_id,
    attendeeId: row.attendee_id,
    status: row.status,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
  };
}

/**
 * Register step 1: insert an active registration, or nothing if the person
 * already has one. Locks the registration (index entry) first, so register
 * and cancel take their locks in the same order: registration, then event.
 * 'active' must be a literal: PostgreSQL picks the partial unique index as
 * the conflict target only when the predicate matches the index's own.
 */
export async function insertActiveRegistration(trx: Trx, eventId: string, attendeeId: string): Promise<Registration | null> {
  const row = await trx
    .insertInto('registrations')
    .values({ event_id: eventId, attendee_id: attendeeId })
    .onConflict((oc) => oc.columns(['event_id', 'attendee_id']).where('status', '=', sql.lit('active')).doNothing())
    .returningAll()
    .executeTakeFirst();
  return row ? toRegistration(row) : null;
}

export async function findActiveRegistration(trx: Trx, eventId: string, attendeeId: string): Promise<Registration | null> {
  const row = await trx
    .selectFrom('registrations')
    .selectAll()
    .where('event_id', '=', eventId)
    .where('attendee_id', '=', attendeeId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  return row ? toRegistration(row) : null;
}

/**
 * Register step 2: take one seat if one is free and the event has not
 * started. The WHERE is checked again after waiting for another transaction's
 * lock on this row, so two requests can never both take the last seat.
 * Returns false when no seat was taken.
 */
export async function takeSeat(trx: Trx, eventId: string): Promise<boolean> {
  const row = await trx
    .updateTable('events')
    .set((eb) => ({ registered_count: eb('registered_count', '+', 1) }))
    .where('id', '=', eventId)
    .whereRef('registered_count', '<', 'capacity')
    .where('starts_at', '>', sql<Date>`now()`)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** Cancel step 1: mark the active registration cancelled, if there is one. */
export async function cancelActiveRegistration(trx: Trx, eventId: string, attendeeId: string): Promise<Registration | null> {
  const row = await trx
    .updateTable('registrations')
    .set({ status: 'cancelled', cancelled_at: sql<Date>`now()` })
    .where('event_id', '=', eventId)
    .where('attendee_id', '=', attendeeId)
    .where('status', '=', 'active')
    .returningAll()
    .executeTakeFirst();
  return row ? toRegistration(row) : null;
}

/**
 * Cancel step 2: give the seat back, only before the event starts. Called
 * only after step 1 changed a row, so a repeated cancel never frees a seat
 * twice. Returns false when the event has started.
 */
export async function freeSeat(trx: Trx, eventId: string): Promise<boolean> {
  const row = await trx
    .updateTable('events')
    .set((eb) => ({ registered_count: eb('registered_count', '-', 1) }))
    .where('id', '=', eventId)
    .where('starts_at', '>', sql<Date>`now()`)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

export interface MyRegistration {
  id: string;
  status: 'active' | 'cancelled';
  createdAt: Date;
  cancelledAt: Date | null;
  event: { id: string; title: string; startsAt: Date; timezone: string };
}

/** The attendee's own registrations, active and cancelled, newest first. Read-only. */
export async function listMyRegistrations(db: Kysely<Database>, attendeeId: string, limit: number): Promise<MyRegistration[]> {
  const rows = await db
    .selectFrom('registrations as r')
    .innerJoin('events as e', 'e.id', 'r.event_id')
    .select(['r.id', 'r.status', 'r.created_at', 'r.cancelled_at', 'e.id as event_id', 'e.title', 'e.starts_at', 'e.timezone'])
    .where('r.attendee_id', '=', attendeeId)
    .orderBy('r.created_at', 'desc')
    .orderBy('r.id')
    .limit(limit)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
    event: { id: row.event_id, title: row.title, startsAt: row.starts_at, timezone: row.timezone },
  }));
}

export interface EventSeatState {
  started: boolean;
  capacity: number;
}

/**
 * Reads whether an event exists and has started. Also used outside a
 * transaction, to explain why a seat could not be taken.
 */
export async function findEventSeatState(db: Kysely<Database>, eventId: string): Promise<EventSeatState | null> {
  const row = await db
    .selectFrom('events')
    .select(['capacity', sql<boolean>`starts_at <= now()`.as('started')])
    .where('id', '=', eventId)
    .executeTakeFirst();
  return row ?? null;
}
