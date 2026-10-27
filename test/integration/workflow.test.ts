import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import type { Problem } from '../../src/http/errors.js';
import type { AttendeeList, EventView } from '../../src/modules/events/schemas.js';
import { createUser, createUsers, seatCounts, testDb } from './helpers.js';

// The brief's workflow end to end, through the real HTTP stack: routes,
// identity check, permissions, validation, the service and PostgreSQL.

// Larger than the 50 parallel requests below; each request also looks up
// the caller's identity, so it needs a connection of its own.
const db = testDb(60);
let app: App;

beforeAll(async () => {
  app = await buildApp({ db, authMode: 'dev-stub', logLevel: 'silent' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const as = (userId: string) => ({ 'x-dev-user-id': userId });

async function createEventOverHttp(organizerId: string, capacity: number): Promise<EventView> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/events',
    headers: as(organizerId),
    payload: {
      title: 'Neighborhood meetup',
      startsAt: new Date(Date.now() + 7 * DAY_MS).toISOString(),
      timezone: 'America/New_York',
      capacity,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<EventView>();
}

const register = (eventId: string, who: string) =>
  app.inject({ method: 'PUT', url: `/v1/events/${eventId}/registrations/me`, headers: as(who) });
const cancel = (eventId: string, who: string) =>
  app.inject({ method: 'DELETE', url: `/v1/events/${eventId}/registrations/me`, headers: as(who) });

describe('the brief workflow', () => {
  it('R1 R3 the brief workflow works over HTTP: create, register, full, cancel, register again', async () => {
    // 1. An organizer creates an event with a date, a time and a capacity.
    const organizer = await createUser(db, ['organizer']);
    const event = await createEventOverHttp(organizer, 2);
    expect(event).toMatchObject({ capacity: 2, registeredCount: 0, seatsLeft: 2 });

    // 2. Attendees register.
    const [ana, ben, cleo] = [await createUser(db), await createUser(db), await createUser(db)];
    expect((await register(event.id, ana)).statusCode).toBe(201);
    expect((await register(event.id, ben)).statusCode).toBe(201);

    // 3. Once capacity is reached, registration is refused.
    const full = await register(event.id, cleo);
    expect(full.statusCode).toBe(409);
    expect(full.json<Problem>().code).toBe('EVENT_FULL');

    // 4. A cancel frees the seat, and someone else can take it.
    expect((await cancel(event.id, ana)).statusCode).toBe(204);
    expect((await register(event.id, cleo)).statusCode).toBe(201);

    const view = await app.inject({ method: 'GET', url: `/v1/events/${event.id}`, headers: as(cleo) });
    expect(view.json<EventView>()).toMatchObject({ registeredCount: 2, seatsLeft: 0, myRegistration: { status: 'active' } });

    const list = await app.inject({ method: 'GET', url: `/v1/events/${event.id}/registrations`, headers: as(organizer) });
    expect(list.json<AttendeeList>().registrations.map((r) => r.attendee.id).sort()).toEqual([ben, cleo].sort());

    expect(await seatCounts(db, event.id)).toEqual({ registeredCount: 2, activeRows: 2 });
  });

  it(
    'R1 50 parallel HTTP registrations for 10 seats give exactly 10',
    async () => {
      const event = await createEventOverHttp(await createUser(db, ['organizer']), 10);
      const people = await createUsers(db, 50);

      // All 50 requests start before any is answered.
      const responses = await Promise.all(people.map((person) => register(event.id, person)));

      const statuses = responses.map((res) => res.statusCode);
      expect(statuses.filter((status) => status === 201)).toHaveLength(10);
      expect(statuses.filter((status) => status === 409)).toHaveLength(40);
      for (const res of responses.filter((r) => r.statusCode === 409)) {
        expect(res.json<Problem>().code).toBe('EVENT_FULL');
      }

      const view = await app.inject({ method: 'GET', url: `/v1/events/${event.id}`, headers: as(people[0] ?? '') });
      expect(view.json<EventView>()).toMatchObject({ registeredCount: 10, seatsLeft: 0 });
      expect(await seatCounts(db, event.id)).toEqual({ registeredCount: 10, activeRows: 10 });
    },
    120_000,
  );
});
