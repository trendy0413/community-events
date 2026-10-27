import { sql } from 'kysely';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import { loadSeedData, seed, seedPeople } from '../../src/db/seed.js';
import { seatCounts, testDb } from './helpers.js';

const db = testDb();
afterAll(() => db.destroy());

/** 24-hour HH:MM of an instant in a time zone. */
const wallClock = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);

describe('database', () => {
  it('runs against PostgreSQL 16 or newer', async () => {
    const { rows } = await sql<{ server_version_num: string }>`SHOW server_version_num`.execute(db);
    expect(Number(rows[0]?.server_version_num)).toBeGreaterThanOrEqual(160000);
  });

  it('applies nothing when migrations run again', async () => {
    const result = await migrate(inject('databaseUrl'));
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain('001_init.sql');
  });

  it('seeds the demo people and upcoming events at their local start time, and can run twice', async () => {
    const data = loadSeedData();
    const [people, events] = [seedPeople(data), data.events];
    // Another test file may have seeded and taken seats already. Seeding
    // itself must never change a count.
    const countsBefore = new Map(
      (
        await db
          .selectFrom('events')
          .select(['id', 'registered_count'])
          .where('id', 'in', events.map((e) => e.id))
          .execute()
      ).map((row) => [row.id, row.registered_count]),
    );

    const now = new Date();
    await seed(db, now);
    await seed(db, now);

    const seededPeople = await db
      .selectFrom('users')
      .select('id')
      .where('id', 'in', people.map((p) => p.id))
      .execute();
    const seededEvents = await db
      .selectFrom('events')
      .select(['id', 'starts_at', 'registered_count'])
      .where('id', 'in', events.map((e) => e.id))
      .execute();

    expect(seededPeople).toHaveLength(people.length);
    expect(seededEvents).toHaveLength(events.length);
    for (const event of seededEvents) {
      expect(event.starts_at.getTime()).toBeGreaterThan(now.getTime());
      const planned = events.find((e) => e.id === event.id);
      expect(wallClock(event.starts_at, planned?.timezone ?? 'UTC')).toBe(planned?.localTime);
      expect(event.registered_count).toBe(countsBefore.get(event.id) ?? 0);
      expect(await seatCounts(db, event.id)).toEqual({
        registeredCount: event.registered_count,
        activeRows: event.registered_count,
      });
    }
  });
});
