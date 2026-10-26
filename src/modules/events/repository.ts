import type { Db } from '../../db/client.js';
import type { OwnedResource } from '../../auth/policy.js';
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

/** The event as the viewer sees it, including the viewer's own active registration. */
export async function findEventView(db: Db, eventId: string, viewerId: string): Promise<EventView | null> {
  const row = await db
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
    ])
    .where('e.id', '=', eventId)
    .executeTakeFirst();
  if (!row) return null;

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

/** Who owns the event, for permission checks. */
export async function findEventOwner(db: Db, eventId: string): Promise<OwnedResource | null> {
  const row = await db.selectFrom('events').select('organizer_id').where('id', '=', eventId).executeTakeFirst();
  return row ? { organizerId: row.organizer_id } : null;
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
