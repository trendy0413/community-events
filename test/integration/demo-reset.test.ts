import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadSeedData, resetDemo, seedPeople } from '../../src/db/seed.js';
import { cancel, register } from '../../src/modules/registrations/service.js';
import { createEvent, createUser, seatCounts, testDb } from './helpers.js';

const db = testDb();

// The reset only runs on a database that holds nothing but seed people, and
// other test files leave their own people behind. These tests empty every
// table, before each test and once more at the end, so no seed rows are left
// for other files (files run one at a time, see vitest.config.ts).
const emptyAllTables = () => sql`TRUNCATE orders, delivery_slots, registrations, events, users`.execute(db);
beforeEach(async () => {
  await emptyAllTables();
});
afterAll(async () => {
  await emptyAllTables();
  await db.destroy();
});

const data = loadSeedData();

describe('demo reset', () => {
  it('W5 demo reset refuses a database with people outside the seed file', async () => {
    const stranger = await createUser(db, ['organizer', 'attendee']);
    const event = await createEvent(db, stranger);
    await register(db, event, stranger);

    await expect(resetDemo(db)).rejects.toThrow('not in seed/personas.json');

    const kept = await db.selectFrom('users').select('id').where('id', '=', stranger).executeTakeFirst();
    expect(kept).toEqual({ id: stranger });
    expect(await seatCounts(db, event)).toEqual({ registeredCount: 1, activeRows: 1 });
  });

  it('W5 demo reset wipes the data and seeds it again', async () => {
    await resetDemo(db);
    // What visitors leave behind: a registration, a cancelled one, and an
    // event of a proof run.
    const [boardGames] = data.events;
    const ana = data.people.find((person) => person.email === 'ana@example.com');
    const [firstInCrowd] = data.crowd;
    if (!boardGames || !ana || !firstInCrowd) throw new Error('seed file changed: update this test');
    await register(db, boardGames.id, ana.id);
    await cancel(db, boardGames.id, firstInCrowd.id);
    const proofRun = await createEvent(db, data.proofOrganizer.id);
    await register(db, proofRun, firstInCrowd.id);

    const result = await resetDemo(db);

    const users = await db.selectFrom('users').select('id').execute();
    expect(users.map((user) => user.id).sort()).toEqual(seedPeople(data).map((person) => person.id).sort());
    const events = await db.selectFrom('events').select('id').execute();
    expect(events.map((event) => event.id).sort()).toEqual(data.events.map((event) => event.id).sort());
    for (const event of data.events) {
      expect(await seatCounts(db, event.id)).toEqual({
        registeredCount: event.crowdRegistrations,
        activeRows: event.crowdRegistrations,
      });
    }
    const { rows } = await db
      .selectFrom('registrations')
      .select((eb) => eb.fn.countAll<string>().as('rows'))
      .executeTakeFirstOrThrow();
    expect(Number(rows)).toBe(result.registrations);
    for (const slot of data.slots) {
      const stored = await db.selectFrom('delivery_slots').select('booked_count').where('id', '=', slot.id).executeTakeFirstOrThrow();
      expect(stored.booked_count, slot.title).toBe(slot.orders.length);
    }
    const orders = await db.selectFrom('orders').select(['id', 'status', 'driver_id']).execute();
    expect(orders).toHaveLength(result.orders);
    expect(orders.filter((order) => order.driver_id).length).toBe(
      data.slots.flatMap((slot) => slot.orders).filter((order) => order.driverId).length,
    );
  });
});
