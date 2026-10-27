import { sql } from 'kysely';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadSeedData, resetDemo, seedPeople } from '../../src/db/seed.js';
import { cancel, register } from '../../src/modules/registrations/service.js';
import { createEvent, createUser, seatCounts, testDb } from './helpers.js';

const db = testDb();
afterAll(() => db.destroy());

const data = loadSeedData();

describe('demo reset', () => {
  // The reset only runs on a database that holds nothing but seed people,
  // and other test files leave their own people behind.
  beforeEach(async () => {
    await sql`TRUNCATE registrations, events, users`.execute(db);
  });

  it('W5 demo reset refuses a database with people outside the seed file', async () => {
    const stranger = await createUser(db);

    await expect(resetDemo(db)).rejects.toThrow('not in seed/personas.json');

    const kept = await db.selectFrom('users').select('id').where('id', '=', stranger).executeTakeFirst();
    expect(kept).toEqual({ id: stranger });
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
  });
});
