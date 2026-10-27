import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import { register } from '../modules/registrations/service.js';
import type { Db } from './client.js';
import { ROLES, type Database } from './schema.js';

const SEED_FILE = path.resolve(import.meta.dirname, '../../seed/personas.json');

const Person = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  email: z.email(),
  roles: z.array(z.enum(ROLES)).min(1),
});

const SeedSchema = z
  .object({
    /** The people a visitor can switch between. */
    people: z.array(Person),
    /** Owns the events that proof runs create, so they stay apart from the people's own. */
    proofOrganizer: Person,
    /** "Another organizer" in the proof page's permission checks. */
    otherProofOrganizer: Person,
    /** Attendees for proof runs and for the seats the demo reset takes. */
    crowd: z.array(Person),
    events: z.array(
      z.object({
        id: z.uuid(),
        organizerId: z.uuid(),
        title: z.string().min(3).max(80),
        description: z.string().max(500),
        startsInDays: z.number().int().min(1).max(300),
        /** Wall-clock start time in the event's time zone, 24-hour HH:MM. */
        localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        timezone: z.string().min(1),
        capacity: z.number().int().min(1).max(500),
        /** Seats the demo reset takes, by the first crowd members. */
        crowdRegistrations: z.number().int().min(0),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    data.events.forEach((event, index) => {
      if (event.crowdRegistrations > Math.min(event.capacity, data.crowd.length)) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', index, 'crowdRegistrations'],
          message: 'Must fit the capacity and the crowd',
        });
      }
    });
  });

export type SeedData = z.infer<typeof SeedSchema>;

export function loadSeedData(): SeedData {
  return SeedSchema.parse(JSON.parse(readFileSync(SEED_FILE, 'utf8')));
}

/** Every user in the seed file. */
export function seedPeople(data: SeedData): SeedData['people'] {
  return [...data.people, data.proofOrganizer, data.otherProofOrganizer, ...data.crowd];
}

/**
 * Upserts the demo people and events. Safe to run again: fixed IDs, and
 * events move forward so they stay upcoming. Registrations are not seeded
 * here; registered_count must change only through the registration service.
 */
export async function seed(db: Db, now: Date = new Date()): Promise<{ people: number; events: number }> {
  const data = loadSeedData();
  await db.transaction().execute((trx) => upsertSeedRows(trx, data, now));
  return { people: seedPeople(data).length, events: data.events.length };
}

export interface ResetResult {
  people: number;
  events: number;
  registrations: number;
}

/**
 * Empties the demo database and seeds it again, then takes each event's
 * `crowdRegistrations` seats. Refuses to run when the database holds a user
 * who is not in the seed file: the demo has no sign-up, so such a user means
 * this is not a demo database.
 *
 * The seats are taken after the wipe has committed. If that step fails, the
 * events are there with fewer seats taken, and running the reset again
 * fixes it.
 */
export async function resetDemo(db: Db, now: Date = new Date()): Promise<ResetResult> {
  const data = loadSeedData();
  const people = seedPeople(data);

  for (let attempt = 1; ; attempt++) {
    try {
      await db.transaction().execute((trx) => wipeAndSeed(trx, data, now));
      break;
    } catch (error) {
      // API requests lock these tables in other orders, so one that arrives
      // meanwhile can deadlock with the wipe. PostgreSQL then ends one side:
      // that request gets a 500, or this attempt rolls back and runs again.
      if (attempt >= WIPE_ATTEMPTS || !isDeadlock(error)) throw error;
    }
  }

  // Through the registration service, the only code that changes
  // registered_count. Each (event, person) pair is distinct, so no two calls
  // race for one registration.
  const seats = data.events.flatMap((event) =>
    data.crowd.slice(0, event.crowdRegistrations).map((person) => ({ eventId: event.id, attendeeId: person.id })),
  );
  await Promise.all(seats.map(({ eventId, attendeeId }) => register(db, eventId, attendeeId)));

  return { people: people.length, events: data.events.length, registrations: seats.length };
}

const WIPE_ATTEMPTS = 3;
const DEADLOCK_DETECTED = '40P01';

function isDeadlock(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === DEADLOCK_DETECTED;
}

/** One transaction: if any step fails, the old data stays. */
async function wipeAndSeed(trx: Kysely<Database>, data: SeedData, now: Date): Promise<void> {
  // Locked first, so no user can be added between the check and the wipe.
  // API requests wait for the commit instead of seeing half-filled tables.
  await sql`LOCK TABLE registrations, events, users IN ACCESS EXCLUSIVE MODE`.execute(trx);
  const stranger = await trx
    .selectFrom('users')
    .select('id')
    .where('id', 'not in', seedPeople(data).map((person) => person.id))
    .limit(1)
    .executeTakeFirst();
  if (stranger) {
    throw new Error('demo reset: this database has users that are not in seed/personas.json, so it is not wiped');
  }
  // All three tables at once: TRUNCATE skips the no-delete trigger on
  // registrations, and emptying them together keeps the counts and the rows
  // in step (SPEC section 5).
  await sql`TRUNCATE registrations, events, users`.execute(trx);
  await upsertSeedRows(trx, data, now);
}

async function upsertSeedRows(db: Kysely<Database>, data: SeedData, now: Date): Promise<void> {
  // One statement per table: the database may be far away, and each round
  // trip costs more than the rows themselves.
  await db
    .insertInto('users')
    .values(seedPeople(data))
    .onConflict((oc) =>
      oc.column('id').doUpdateSet((eb) => ({
        name: eb.ref('excluded.name'),
        email: eb.ref('excluded.email'),
        roles: eb.ref('excluded.roles'),
      })),
    )
    .execute();

  await db
    .insertInto('events')
    .values(
      data.events.map((event) => ({
        id: event.id,
        organizer_id: event.organizerId,
        title: event.title,
        description: event.description,
        // The event's local date of now, plus startsInDays, at localTime.
        // PostgreSQL does the time zone math, daylight saving time included.
        starts_at: sql<Date>`(date_trunc('day', ${now}::timestamptz AT TIME ZONE ${event.timezone})
          + make_interval(days => ${event.startsInDays}::int) + ${event.localTime}::time) AT TIME ZONE ${event.timezone}`,
        timezone: event.timezone,
        capacity: event.capacity,
      })),
    )
    // Capacity is left alone on conflict: lowering it below the seats
    // already taken would break the capacity CHECK.
    .onConflict((oc) =>
      oc.column('id').doUpdateSet((eb) => ({
        title: eb.ref('excluded.title'),
        description: eb.ref('excluded.description'),
        starts_at: eb.ref('excluded.starts_at'),
        timezone: eb.ref('excluded.timezone'),
        updated_at: new Date(),
      })),
    )
    .execute();
}
