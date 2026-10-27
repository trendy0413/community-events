import { sql } from 'kysely';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import { loadSeedData, seed, seedPeople } from '../../src/db/seed.js';
import { seatCounts, testDb } from './helpers.js';

const db = testDb();
afterAll(() => db.destroy());

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

  it('seeds the demo people and upcoming events, and can run twice', async () => {
    const now = new Date();
    await seed(db, now);
    await seed(db, now);

    const data = loadSeedData();
    const [people, events] = [seedPeople(data), data.events];
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
      // Seeding never changes a seat count; other test files may have taken seats.
      expect(await seatCounts(db, event.id)).toEqual({
        registeredCount: event.registered_count,
        activeRows: event.registered_count,
      });
    }
  });
});
