import { sql } from 'kysely';
import type { OwnedResource } from '../../auth/policy.js';
import type { Db } from '../../db/client.js';
import type { AttendeeList, CreateEventInput, EventView } from './schemas.js';

export async function insertEvent(db: Db, organizerId: string, input: CreateEventInput): Promise<string> {
  const { id } = await db
    .insertInto('events')
    .values({
      organizer_id: organizerId,
      title: input.title,
      description: input.description,
      starts_at: input.startsAt,
      timezone: input.timezone,
      capacity: input.capacity,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

/** Events as the viewer sees them, including the viewer's own active registration. */
function eventViews(db: Db, viewerId: string) {
  return db
    .selectFrom('events as e')
    .innerJoin('users as o', 'o.id', 'e.organizer_id')
    .leftJoin('registrations as r', (join) =>
      join.onRef('r.event_id', '=', 'e.id').on('r.attendee_id', '=', viewerId).on('r.status', '=', 'active'),
    )
    .select([
      'e.id',
      'e.title',
      'e.description',
      'e.starts_at',
      'e.timezone',
      'e.capacity',
      'e.registered_count',
      'o.id as organizer_id',
      'o.name as organizer_name',
      'r.id as my_registration_id',
    ]);
}

type EventViewRow = Awaited<ReturnType<ReturnType<typeof eventViews>['executeTakeFirstOrThrow']>>;

function toEventView(row: EventViewRow): EventView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    timezone: row.timezone,
    capacity: row.capacity,
    registeredCount: row.registered_count,
    seatsLeft: row.capacity - row.registered_count,
    organizer: { id: row.organizer_id, name: row.organizer_name },
    myRegistration: row.my_registration_id ? { id: row.my_registration_id, status: 'active' } : null,
  };
}

export async function findEventView(db: Db, eventId: string, viewerId: string): Promise<EventView | null> {
  const row = await eventViews(db, viewerId).where('e.id', '=', eventId).executeTakeFirst();
  return row ? toEventView(row) : null;
}

export interface EventListFilter {
  /** Only this organizer's events. */
  organizerId?: string;
  /** Only events that have started, newest first (admins only; checked by the route). Otherwise only upcoming ones. */
  past: boolean;
  limit: number;
}

export async function listEventViews(db: Db, viewerId: string, filter: EventListFilter): Promise<EventView[]> {
  // Upcoming and past are separate lists: in one list, either kind could
  // fill every row up to `limit` and hide the other. Each list starts
  // nearest to now. The id breaks ties, so the order is stable when two
  // events start together.
  let query = eventViews(db, viewerId).where('e.starts_at', filter.past ? '<=' : '>', sql<Date>`now()`);
  if (filter.organizerId) query = query.where('e.organizer_id', '=', filter.organizerId);
  const rows = await query
    .orderBy('e.starts_at', filter.past ? 'desc' : 'asc')
    .orderBy('e.id')
    .limit(filter.limit)
    .execute();
  return rows.map(toEventView);
}

/** Who owns the event, for permission checks. */
export async function findEventOwner(db: Db, eventId: string): Promise<OwnedResource | null> {
  const row = await db.selectFrom('events').select('organizer_id').where('id', '=', eventId).executeTakeFirst();
  return row ? { ownerId: row.organizer_id } : null;
}

/**
 * R7 in one statement: the new capacity is applied only if it still holds
 * everyone registered and the event has not started. A register that races
 * this waits for the row lock, then checks registered_count < capacity
 * against the new capacity. The organizer_id condition is a second guard
 * after the route's permission check. Returns false when nothing changed.
 */
export async function updateCapacity(db: Db, eventId: string, organizerId: string, capacity: number): Promise<boolean> {
  const row = await db
    .updateTable('events')
    .set({ capacity, updated_at: sql<Date>`now()` })
    .where('id', '=', eventId)
    .where('organizer_id', '=', organizerId)
    .where('registered_count', '<=', capacity)
    .where('starts_at', '>', sql<Date>`clock_timestamp()`)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

export interface CapacityState {
  organizerId: string;
  started: boolean;
  registeredCount: number;
}

/** Why a capacity change did not apply: read after the failed update. */
export async function findCapacityState(db: Db, eventId: string): Promise<CapacityState | null> {
  const row = await db
    .selectFrom('events')
    .select(['organizer_id', 'registered_count', sql<boolean>`starts_at <= clock_timestamp()`.as('started')])
    .where('id', '=', eventId)
    .executeTakeFirst();
  return row ? { organizerId: row.organizer_id, started: row.started, registeredCount: row.registered_count } : null;
}

export async function listActiveRegistrations(db: Db, eventId: string): Promise<AttendeeList> {
  const rows = await db
    .selectFrom('registrations as r')
    .innerJoin('users as u', 'u.id', 'r.attendee_id')
    .select(['r.id', 'u.id as attendee_id', 'u.name as attendee_name', 'r.created_at'])
    .where('r.event_id', '=', eventId)
    .where('r.status', '=', 'active')
    .orderBy('r.created_at')
    .execute();
  return {
    registrations: rows.map((row) => ({
      id: row.id,
      attendee: { id: row.attendee_id, name: row.attendee_name },
      registeredAt: row.created_at.toISOString(),
    })),
  };
}
