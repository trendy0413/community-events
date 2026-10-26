import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';
import { createDb, type Db } from '../../src/db/client.js';
import type { Role } from '../../src/db/schema.js';

/** A Kysely instance on the test database (see global-setup.ts). */
export function testDb(max?: number): Db {
  return createDb(inject('databaseUrl'), max === undefined ? {} : { max });
}

// Every helper makes fresh rows with random IDs and emails, so test files can
// run in parallel on one database without seeing each other's data.

export async function createUser(db: Db, roles: Role[] = ['attendee']): Promise<string> {
  const { id } = await db
    .insertInto('users')
    .values({ email: `${randomUUID()}@example.com`, name: 'Test person', roles })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

export async function createEvent(
  db: Db,
  organizerId: string,
  overrides: { capacity?: number; startsAt?: Date } = {},
): Promise<string> {
  const { id } = await db
    .insertInto('events')
    .values({
      organizer_id: organizerId,
      title: 'Test event',
      description: null,
      starts_at: overrides.startsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      timezone: 'America/New_York',
      capacity: overrides.capacity ?? 10,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}
