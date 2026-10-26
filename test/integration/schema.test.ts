import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { createEvent, createUser, testDb } from './helpers.js';

const db = testDb();
afterAll(() => db.destroy());

// PostgreSQL error codes the schema relies on.
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';

// These tests prove the database itself refuses bad states, so a bug in the
// application code cannot store them (SPEC sections 5 and 8). Each one names
// the constraint that must fire, so a different constraint cannot pass it.
describe('schema', () => {
  it('never stores more registrations than seats (registered_count CHECK)', async () => {
    const eventId = await createEvent(db, await createUser(db, ['organizer']), { capacity: 2 });
    const violation = { code: CHECK_VIOLATION, constraint: 'events_registered_count_within_capacity' };

    await expect(
      db.updateTable('events').set({ registered_count: 3 }).where('id', '=', eventId).execute(),
    ).rejects.toMatchObject(violation);
    await expect(
      db.updateTable('events').set({ registered_count: -1 }).where('id', '=', eventId).execute(),
    ).rejects.toMatchObject(violation);
  });

  it('rejects a capacity of zero', async () => {
    const organizerId = await createUser(db, ['organizer']);
    await expect(createEvent(db, organizerId, { capacity: 0 })).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'events_capacity_positive',
    });
  });

  it('allows one active registration per person per event', async () => {
    const eventId = await createEvent(db, await createUser(db, ['organizer']));
    const attendeeId = await createUser(db);

    await db.insertInto('registrations').values({ event_id: eventId, attendee_id: attendeeId }).execute();
    await expect(
      db.insertInto('registrations').values({ event_id: eventId, attendee_id: attendeeId }).execute(),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'registrations_one_active_per_attendee' });
  });

  it('accepts the SPEC register insert, with the partial index as its ON CONFLICT target', async () => {
    const eventId = await createEvent(db, await createUser(db, ['organizer']));
    const attendeeId = await createUser(db);
    // The exact statement from SPEC section 8, step 1. 'active' is a literal:
    // the index predicate must match it for PostgreSQL to use the index.
    const register = () =>
      sql<{ id: string }>`
        INSERT INTO registrations (event_id, attendee_id) VALUES (${eventId}, ${attendeeId})
        ON CONFLICT (event_id, attendee_id) WHERE status = 'active' DO NOTHING
        RETURNING id`.execute(db);

    expect((await register()).rows).toHaveLength(1);
    expect((await register()).rows).toHaveLength(0);
  });

  it('keeps a cancelled registration as history and allows registering again', async () => {
    const eventId = await createEvent(db, await createUser(db, ['organizer']));
    const attendeeId = await createUser(db);

    await db
      .insertInto('registrations')
      .values({ event_id: eventId, attendee_id: attendeeId, status: 'cancelled', cancelled_at: new Date() })
      .execute();
    await db.insertInto('registrations').values({ event_id: eventId, attendee_id: attendeeId }).execute();

    const rows = await db.selectFrom('registrations').select('status').where('event_id', '=', eventId).execute();
    expect(rows.map((row) => row.status).sort()).toEqual(['active', 'cancelled']);
  });

  it('sets cancelled_at exactly when the status is cancelled', async () => {
    const eventId = await createEvent(db, await createUser(db, ['organizer']));
    const attendeeId = await createUser(db);
    const violation = { code: CHECK_VIOLATION, constraint: 'registrations_cancelled_at_matches_status' };

    await expect(
      db.insertInto('registrations').values({ event_id: eventId, attendee_id: attendeeId, status: 'cancelled' }).execute(),
    ).rejects.toMatchObject(violation);
    await expect(
      db.insertInto('registrations').values({ event_id: eventId, attendee_id: attendeeId, cancelled_at: new Date() }).execute(),
    ).rejects.toMatchObject(violation);
  });

  it('never deletes a registration', async () => {
    const eventId = await createEvent(db, await createUser(db, ['organizer']));
    await db.insertInto('registrations').values({ event_id: eventId, attendee_id: await createUser(db) }).execute();

    await expect(db.deleteFrom('registrations').where('event_id', '=', eventId).execute()).rejects.toMatchObject({
      code: RESTRICT_VIOLATION,
    });
  });

  it('refuses to delete an event or a user that has registrations (ON DELETE RESTRICT)', async () => {
    const eventId = await createEvent(db, await createUser(db, ['organizer']));
    const attendeeId = await createUser(db);
    await db.insertInto('registrations').values({ event_id: eventId, attendee_id: attendeeId }).execute();

    await expect(db.deleteFrom('events').where('id', '=', eventId).execute()).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
      constraint: 'registrations_event_id_fkey',
    });
    await expect(db.deleteFrom('users').where('id', '=', attendeeId).execute()).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
      constraint: 'registrations_attendee_id_fkey',
    });

    // NO ACTION fails the same way at statement end, so the catalog is the
    // only place that tells RESTRICT apart. 'r' = RESTRICT.
    const { rows } = await sql<{ name: string; on_delete: string }>`
      SELECT conname AS name, confdeltype AS on_delete FROM pg_constraint
      WHERE contype = 'f' AND conrelid IN ('registrations'::regclass, 'events'::regclass)
      ORDER BY conname`.execute(db);
    expect(rows).toEqual([
      { name: 'events_organizer_id_fkey', on_delete: 'r' },
      { name: 'registrations_attendee_id_fkey', on_delete: 'r' },
      { name: 'registrations_event_id_fkey', on_delete: 'r' },
    ]);
  });

  it('treats emails that differ only by case as the same person', async () => {
    const email = `Case-${String(Date.now())}@Example.com`;
    await db.insertInto('users').values({ email, name: 'A', roles: ['attendee'] }).execute();

    await expect(
      db.insertInto('users').values({ email: email.toLowerCase(), name: 'B', roles: ['attendee'] }).execute(),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'users_email_lower_key' });
  });

  it('accepts only known roles, and at least one', async () => {
    const violation = { code: CHECK_VIOLATION, constraint: 'users_roles_valid' };
    await expect(
      sql`INSERT INTO users (email, name, roles) VALUES ('x-role@example.com', 'X', ARRAY['root'])`.execute(db),
    ).rejects.toMatchObject(violation);
    await expect(
      sql`INSERT INTO users (email, name, roles) VALUES ('y-role@example.com', 'Y', ARRAY[]::text[])`.execute(db),
    ).rejects.toMatchObject(violation);
  });
});
