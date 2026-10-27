import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';
import type { App } from '../../src/http/app.js';
import { createDb, type Db } from '../../src/db/client.js';
import type { Role } from '../../src/db/schema.js';

/** A Kysely instance on the test database (see global-setup.ts). */
export function testDb(max?: number): Db {
  return createDb(inject('databaseUrl'), max === undefined ? {} : { max });
}

// Every helper makes fresh rows with random IDs and emails, so tests never see
// each other's data. (Files still run one at a time: see vitest.config.ts.)

export async function createUser(db: Db, roles: Role[] = ['attendee']): Promise<string> {
  const { id } = await db
    .insertInto('users')
    .values({ email: `${randomUUID()}@example.com`, name: 'Test person', roles })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

/** One statement for all of them: setup should not open a connection per user. */
export async function createUsers(db: Db, count: number, roles: Role[] = ['attendee']): Promise<string[]> {
  const rows = await db
    .insertInto('users')
    .values(Array.from({ length: count }, () => ({ email: `${randomUUID()}@example.com`, name: 'Test person', roles })))
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

/**
 * The event's stored seat count and its real number of active registrations.
 * The two must always be equal; every race test ends by checking that.
 */
export async function seatCounts(db: Db, eventId: string): Promise<{ registeredCount: number; activeRows: number }> {
  const event = await db
    .selectFrom('events')
    .select('registered_count')
    .where('id', '=', eventId)
    .executeTakeFirstOrThrow();
  const { activeRows } = await db
    .selectFrom('registrations')
    .select((eb) => eb.fn.countAll<string>().as('activeRows'))
    .where('event_id', '=', eventId)
    .where('status', '=', 'active')
    .executeTakeFirstOrThrow();
  return { registeredCount: event.registered_count, activeRows: Number(activeRows) };
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

/**
 * Every /v1 operation the server answers, as "PATCH /v1/events/{id}", read
 * from Fastify's own route tree. Unlike the OpenAPI contract, this also
 * lists routes hidden from the docs. HEAD is left out: Fastify adds it to
 * every GET.
 */
export function v1Operations(app: App): string[] {
  const segments: string[] = [];
  const operations: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const node = /^((?:│ {3}| {4})*)[├└]── (\S+)(?: \(([^)]*)\))?$/.exec(line);
    if (!node) continue;
    const [, indent = '', segment = '', methods = ''] = node;
    segments.length = indent.length / 4;
    segments.push(segment);
    const path = segments.join('').replace(/:(\w+)/g, '{$1}');
    if (!path.startsWith('/v1/') && path !== '/v1') continue;
    for (const method of methods.split(', ')) {
      if (method && method !== 'HEAD') operations.push(`${method} ${path}`);
    }
  }
  if (operations.length === 0) throw new Error('v1Operations: no /v1 routes found; did the route tree format change?');
  return operations.sort();
}

/**
 * The operation a test request calls, in the v1Operations form. `id` is
 * replaced by {id}; `params` names other path values, as { [orderId]: 'orderId' }.
 */
export function operationOf(method: string, url: string, id: string, params: Record<string, string> = {}): string {
  let path = url.split('?')[0] ?? url;
  for (const [value, name] of Object.entries(params)) path = path.replaceAll(value, `{${name}}`);
  return `${method} ${path.replaceAll(id, '{id}')}`;
}
