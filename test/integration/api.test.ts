import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/http/app.js';
import type { Problem } from '../../src/http/errors.js';
import type { EventView } from '../../src/modules/events/schemas.js';
import { createUser, operationOf, testDb, v1Operations } from './helpers.js';

const db = testDb();
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
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();
const validEvent = (capacity = 2) => ({
  title: 'Board game night',
  startsAt: inDays(7),
  timezone: 'America/New_York',
  capacity,
});

async function createEventAs(organizerId: string, capacity = 2): Promise<EventView> {
  const res = await app.inject({ method: 'POST', url: '/v1/events', headers: as(organizerId), payload: validEvent(capacity) });
  expect(res.statusCode).toBe(201);
  return res.json<EventView>();
}

describe('API', () => {
  it('R5 attendee cannot create an event', async () => {
    const attendee = await createUser(db, ['attendee']);
    const organizer = await createUser(db, ['organizer']);

    const denied = await app.inject({ method: 'POST', url: '/v1/events', headers: as(attendee), payload: validEvent() });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<Problem>().code).toBe('FORBIDDEN');

    const created = await app.inject({ method: 'POST', url: '/v1/events', headers: as(organizer), payload: validEvent(2) });
    expect(created.statusCode).toBe(201);
    const event = created.json<EventView>();
    expect(created.headers.location).toBe(`/v1/events/${event.id}`);
    expect(event).toMatchObject({ capacity: 2, registeredCount: 0, seatsLeft: 2, myRegistration: null });
    expect(event.organizer.id).toBe(organizer);
  });

  it('R6 attendee cannot see the attendee list', async () => {
    const owner = await createUser(db, ['organizer']);
    const otherOrganizer = await createUser(db, ['organizer']);
    const admin = await createUser(db, ['admin']);
    const attendee = await createUser(db, ['attendee']);
    const event = await createEventAs(owner);
    await app.inject({ method: 'PUT', url: `/v1/events/${event.id}/registrations/me`, headers: as(attendee) });
    const url = `/v1/events/${event.id}/registrations`;

    for (const who of [attendee, otherOrganizer]) {
      const res = await app.inject({ method: 'GET', url, headers: as(who) });
      expect(res.statusCode).toBe(403);
      expect(res.json<Problem>().code).toBe('FORBIDDEN');
    }
    for (const who of [owner, admin]) {
      const res = await app.inject({ method: 'GET', url, headers: as(who) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        registrations: [{ id: expect.any(String) as string, attendee: { id: attendee, name: 'Test person' }, registeredAt: expect.any(String) as string }],
      });
      // Names and times only: no email reaches the organizer.
      expect(res.body).not.toContain('@');
    }
  });

  // Every /v1 route except /v1/health, each with input that is also invalid
  // where it takes any: if the identity check ran after validation, these
  // would answer 400 instead of 401.
  const EVERY_ROUTE = [
    { method: 'GET', url: '/v1/me' },
    { method: 'GET', url: '/v1/users' },
    { method: 'GET', url: '/v1/events?limit=0' },
    { method: 'POST', url: '/v1/events', payload: { title: 'x' } },
    { method: 'GET', url: '/v1/events/not-a-uuid' },
    { method: 'PATCH', url: '/v1/events/not-a-uuid', payload: {} },
    { method: 'GET', url: '/v1/events/not-a-uuid/registrations' },
    { method: 'PUT', url: '/v1/events/not-a-uuid/registrations/me' },
    { method: 'DELETE', url: '/v1/events/not-a-uuid/registrations/me' },
    { method: 'GET', url: '/v1/me/registrations?limit=0' },
    { method: 'GET', url: '/v1/slots?limit=0' },
    { method: 'POST', url: '/v1/slots', payload: { title: 'x' } },
    { method: 'GET', url: '/v1/slots/not-a-uuid' },
    { method: 'GET', url: '/v1/slots/not-a-uuid/orders' },
    { method: 'PUT', url: '/v1/slots/not-a-uuid/orders/no-order', payload: {} },
    { method: 'DELETE', url: '/v1/orders/no-order' },
    { method: 'GET', url: '/v1/me/orders?limit=0' },
    { method: 'GET', url: '/v1/jobs' },
    { method: 'PUT', url: '/v1/jobs/no-order/driver' },
    { method: 'PUT', url: '/v1/jobs/no-order/delivered' },
  ] as const;

  async function expectUnauthenticated(headers: Record<string, string>): Promise<void> {
    for (const route of EVERY_ROUTE) {
      const res = await app.inject({ ...route, headers });
      const label = `${route.method} ${route.url} ${JSON.stringify(headers)}`;
      expect(res.statusCode, label).toBe(401);
      expect(res.headers['content-type'], label).toMatch(/^application\/problem\+json/);
      expect(res.json<Problem>().code, label).toBe('UNAUTHENTICATED');
    }
  }

  it('R8 request without identity gets 401', async () => {
    await expectUnauthenticated({});
    await expectUnauthenticated({ 'x-dev-user-id': 'not-a-uuid' });

    // The list must name every route the server answers, so a new route (or
    // one registered outside the identity scope by mistake) cannot skip this.
    const covered = EVERY_ROUTE.map((route) => operationOf(route.method, route.url, 'not-a-uuid', { 'no-order': 'orderId' }));
    expect(v1Operations(app).filter((operation) => operation !== 'GET /v1/health').sort()).toEqual([...covered].sort());
  });

  it('R8 unknown user gets 401', async () => {
    await expectUnauthenticated(as(randomUUID()));
  });

  it('R10 rejects invalid event input', async () => {
    const organizer = await createUser(db, ['organizer']);
    const cases: [string, Record<string, unknown>, string][] = [
      ['title too short', { ...validEvent(), title: 'ab' }, 'title'],
      ['title of spaces only', { ...validEvent(), title: '     ' }, 'title'],
      ['title too long', { ...validEvent(), title: 'x'.repeat(81) }, 'title'],
      ['title with a NUL character', { ...validEvent(), title: 'Book\u0000club' }, 'title'],
      ['description with a NUL character', { ...validEvent(), description: 'a\u0000b' }, 'description'],
      ['title missing', { startsAt: inDays(7), timezone: 'America/New_York', capacity: 2 }, 'title'],
      ['description too long', { ...validEvent(), description: 'x'.repeat(501) }, 'description'],
      ['capacity zero', { ...validEvent(), capacity: 0 }, 'capacity'],
      ['capacity above 500', { ...validEvent(), capacity: 501 }, 'capacity'],
      ['capacity not whole', { ...validEvent(), capacity: 2.5 }, 'capacity'],
      ['start in the past', { ...validEvent(), startsAt: inDays(-1) }, 'startsAt'],
      ['start a year away', { ...validEvent(), startsAt: inDays(366) }, 'startsAt'],
      ['start without offset', { ...validEvent(), startsAt: '2027-01-15T18:00:00' }, 'startsAt'],
      ['unknown time zone', { ...validEvent(), timezone: 'Mars/Olympus_Mons' }, 'timezone'],
      ['offset instead of a time zone', { ...validEvent(), timezone: '+05:30' }, 'timezone'],
      ['unknown field', { ...validEvent(), price: 10 }, 'body'],
    ];

    for (const [name, payload, field] of cases) {
      const res = await app.inject({ method: 'POST', url: '/v1/events', headers: as(organizer), payload });
      expect(res.statusCode, name).toBe(400);
      const body = res.json<Problem>();
      expect(body.code, name).toBe('VALIDATION_FAILED');
      expect(body.errors?.map((error) => error.field), name).toContain(field);
    }

    const created = await db.selectFrom('events').select('id').where('organizer_id', '=', organizer).execute();
    expect(created).toEqual([]);

    // The limits themselves are allowed, so a rule that is too strict fails too.
    const accepted: [string, Record<string, unknown>, Partial<EventView>][] = [
      ['title of 3 characters', { ...validEvent(), title: 'Art' }, { title: 'Art' }],
      ['title of 80 characters', { ...validEvent(), title: 'x'.repeat(80) }, { title: 'x'.repeat(80) }],
      ['title with spaces around it', { ...validEvent(), title: '  Book club  ' }, { title: 'Book club' }],
      ['description of 500', { ...validEvent(), description: 'd'.repeat(500) }, { description: 'd'.repeat(500) }],
      ['empty description', { ...validEvent(), description: '' }, { description: null }],
      ['capacity 1', { ...validEvent(), capacity: 1 }, { capacity: 1 }],
      ['capacity 500', { ...validEvent(), capacity: 500 }, { capacity: 500 }],
      ['offset start almost a year away', { ...validEvent(), startsAt: inDays(364).replace('Z', '+05:30') }, {}],
      ['offset beyond what PostgreSQL parses', { ...validEvent(), startsAt: inDays(7).replace('Z', '+23:59') }, {}],
      ['current IANA name kept', { ...validEvent(), timezone: 'Europe/Kyiv' }, { timezone: 'Europe/Kyiv' }],
      ['UTC', { ...validEvent(), timezone: 'UTC' }, { timezone: 'UTC' }],
      ['lower-case time zone', { ...validEvent(), timezone: 'america/new_york' }, { timezone: 'America/New_York' }],
    ];
    const otherOrganizer = await createUser(db, ['organizer']);
    for (const [name, payload, expected] of accepted) {
      const res = await app.inject({ method: 'POST', url: '/v1/events', headers: as(otherOrganizer), payload });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(201);
      expect(res.json<EventView>(), name).toMatchObject(expected);
    }
  });

  it('answers register and cancel with the SPEC status codes', async () => {
    const event = await createEventAs(await createUser(db, ['organizer']), 1);
    const [first, second] = [await createUser(db), await createUser(db)];
    const seat = (method: 'PUT' | 'DELETE', who: string) =>
      app.inject({ method, url: `/v1/events/${event.id}/registrations/me`, headers: as(who) });

    const created = await seat('PUT', first);
    expect(created.statusCode).toBe(201);
    const again = await seat('PUT', first);
    expect(again.statusCode).toBe(200);
    expect(again.json<{ id: string }>().id).toBe(created.json<{ id: string }>().id);

    const full = await seat('PUT', second);
    expect(full.statusCode).toBe(409);
    expect(full.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(full.json<Problem>()).toMatchObject({ code: 'EVENT_FULL', detail: 'All 1 seats are taken.' });

    expect((await seat('DELETE', first)).statusCode).toBe(204);
    expect((await seat('DELETE', first)).statusCode).toBe(204);
    expect((await seat('PUT', second)).statusCode).toBe(201);

    const view = await app.inject({ method: 'GET', url: `/v1/events/${event.id}`, headers: as(second) });
    expect(view.json<EventView>()).toMatchObject({ registeredCount: 1, seatsLeft: 0, myRegistration: { status: 'active' } });
  });

  it('answers a malformed event id with VALIDATION_FAILED and an unknown one with NOT_FOUND', async () => {
    const attendee = await createUser(db);

    const malformed = await app.inject({ method: 'GET', url: '/v1/events/not-a-uuid', headers: as(attendee) });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json<Problem>().code).toBe('VALIDATION_FAILED');

    const organizer = await createUser(db, ['organizer']);
    for (const [method, url, who, payload] of [
      ['GET', `/v1/events/${randomUUID()}`, attendee, undefined],
      ['PATCH', `/v1/events/${randomUUID()}`, organizer, { capacity: 5 }],
      ['GET', `/v1/events/${randomUUID()}/registrations`, organizer, undefined],
      ['PUT', `/v1/events/${randomUUID()}/registrations/me`, attendee, undefined],
      ['DELETE', `/v1/events/${randomUUID()}/registrations/me`, attendee, undefined],
    ] as const) {
      const res = await app.inject({ method, url, headers: as(who), ...(payload && { payload }) });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json<Problem>().code).toBe('NOT_FOUND');
    }
  });

  it('lets only attendees register', async () => {
    const event = await createEventAs(await createUser(db, ['organizer']));
    for (const roles of [['organizer'], ['admin']] as const) {
      const who = await createUser(db, [...roles]);
      const res = await app.inject({ method: 'PUT', url: `/v1/events/${event.id}/registrations/me`, headers: as(who) });
      expect(res.statusCode, roles.join()).toBe(403);
    }
  });
});
