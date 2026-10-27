import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/http/app.js';
import { createDb } from '../../src/db/client.js';
import type { Problem } from '../../src/http/errors.js';
import type { EventView } from '../../src/modules/events/schemas.js';
import { insertSlot } from '../../src/modules/supply/repository.js';
import { placeOrder } from '../../src/modules/supply/service.js';
import { createUser, createUsers, operationOf, seatCounts, testDb, v1Operations } from './helpers.js';

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

const HOUR_MS = 60 * 60 * 1000;
const as = (userId: string) => ({ 'x-dev-user-id': userId });
const inHours = (hours: number) => new Date(Date.now() + hours * HOUR_MS).toISOString();
const slotBody = { title: 'Morning run', area: 'Downtown', startsAt: inHours(2), timezone: 'UTC', capacity: 2 };
const orderBody = { items: '10 sheets of drywall', jobsite: '4 Pier Rd' };

const eventBody = (options: { capacity?: number; inHours?: number } = {}) => ({
  title: 'Reading circle',
  // Soon, so these events come before other tests' events in "soonest first" lists.
  startsAt: new Date(Date.now() + (options.inHours ?? 1) * HOUR_MS).toISOString(),
  timezone: 'America/New_York',
  capacity: options.capacity ?? 3,
});

async function createEventAs(organizerId: string, options: { capacity?: number; inHours?: number } = {}): Promise<EventView> {
  const res = await app.inject({ method: 'POST', url: '/v1/events', headers: as(organizerId), payload: eventBody(options) });
  expect(res.statusCode).toBe(201);
  return res.json<EventView>();
}

/** Moves an event's start into the past (the API never accepts a past start). */
const moveToPast = (eventId: string, hoursAgo = 1) =>
  db.updateTable('events').set({ starts_at: new Date(Date.now() - hoursAgo * HOUR_MS) }).where('id', '=', eventId).execute();

const registerAs = (eventId: string, who: string) =>
  app.inject({ method: 'PUT', url: `/v1/events/${eventId}/registrations/me`, headers: as(who) });

const setCapacity = (eventId: string, who: string, capacity: number) =>
  app.inject({ method: 'PATCH', url: `/v1/events/${eventId}`, headers: as(who), payload: { capacity } });

const listIds = async (query: string, who: string): Promise<string[]> => {
  const res = await app.inject({ method: 'GET', url: `/v1/events?${query}`, headers: as(who) });
  expect(res.statusCode, `${query}: ${res.body}`).toBe(200);
  return res.json<{ events: EventView[] }>().events.map((event) => event.id);
};

describe('capacity change', () => {
  it("R5 organizer cannot change another organizer's event", async () => {
    const owner = await createUser(db, ['organizer']);
    const event = await createEventAs(owner, { capacity: 3 });

    for (const roles of [['organizer'], ['attendee'], ['admin']] as const) {
      const res = await setCapacity(event.id, await createUser(db, [...roles]), 10);
      expect(res.statusCode, roles.join()).toBe(403);
      expect(res.json<Problem>().code).toBe('FORBIDDEN');
    }
    const unchanged = await app.inject({ method: 'GET', url: `/v1/events/${event.id}`, headers: as(owner) });
    expect(unchanged.json<EventView>().capacity).toBe(3);

    const changed = await setCapacity(event.id, owner, 10);
    expect(changed.statusCode).toBe(200);
    expect(changed.json<EventView>()).toMatchObject({ capacity: 10, seatsLeft: 10 });
  });

  it('R7 rejects capacity below registered count', async () => {
    const owner = await createUser(db, ['organizer']);
    const event = await createEventAs(owner, { capacity: 3 });
    for (const person of await createUsers(db, 2)) {
      expect((await registerAs(event.id, person)).statusCode).toBe(201);
    }

    const tooLow = await setCapacity(event.id, owner, 1);
    expect(tooLow.statusCode).toBe(409);
    expect(tooLow.json<Problem>()).toMatchObject({
      code: 'CAPACITY_BELOW_REGISTERED',
      detail: '2 people are registered, so the capacity cannot go below 2.',
    });

    // Exactly the number registered is allowed: everyone keeps a seat.
    const exact = await setCapacity(event.id, owner, 2);
    expect(exact.statusCode).toBe(200);
    expect(exact.json<EventView>()).toMatchObject({ capacity: 2, registeredCount: 2, seatsLeft: 0 });
    expect(await seatCounts(db, event.id)).toEqual({ registeredCount: 2, activeRows: 2 });
  });

  it('R7 rejects capacity change after the event starts', async () => {
    const owner = await createUser(db, ['organizer']);
    const event = await createEventAs(owner);
    for (const person of await createUsers(db, 2)) {
      expect((await registerAs(event.id, person)).statusCode).toBe(201);
    }
    await moveToPast(event.id);

    // Both a raise and a cut below the 2 registered: "started" wins over every other reason.
    for (const capacity of [10, 1]) {
      const res = await setCapacity(event.id, owner, capacity);
      expect(res.statusCode, String(capacity)).toBe(409);
      expect(res.json<Problem>().code, String(capacity)).toBe('EVENT_STARTED');
    }
  });

  it('R7 capacity decrease racing registrations never overbooks', async () => {
    const PEOPLE = 15;
    // Its own pool, larger than the number of parallel calls.
    const raceDb = testDb(PEOPLE + 5);
    const raceApp = await buildApp({ db: raceDb, authMode: 'dev-stub', logLevel: 'silent' });
    try {
      const owner = await createUser(db, ['organizer']);
      const event = await createEventAs(owner, { capacity: 20 });
      const people = await createUsers(db, PEOPLE);

      const [lower, ...registers] = await Promise.all([
        raceApp.inject({ method: 'PATCH', url: `/v1/events/${event.id}`, headers: as(owner), payload: { capacity: 10 } }),
        ...people.map((who) =>
          raceApp.inject({ method: 'PUT', url: `/v1/events/${event.id}/registrations/me`, headers: as(who) }),
        ),
      ]);

      const seated = registers.filter((res) => res.statusCode === 201).length;
      const full = registers.filter((res) => res.statusCode === 409 && res.json<Problem>().code === 'EVENT_FULL').length;
      expect(seated + full, 'every register answers 201 or EVENT_FULL').toBe(PEOPLE);

      // Either order is correct. Lowered first: registrations stop at 10.
      // Registered first: more than 10 hold a seat, so the decrease is refused.
      const lowered = lower.statusCode === 200;
      expect(lowered || lower.json<Problem>().code === 'CAPACITY_BELOW_REGISTERED', lower.body).toBe(true);
      const { capacity } = await db.selectFrom('events').select('capacity').where('id', '=', event.id).executeTakeFirstOrThrow();
      expect({ capacity, seated }).toEqual(lowered ? { capacity: 10, seated: 10 } : { capacity: 20, seated: PEOPLE });
      expect(await seatCounts(db, event.id)).toEqual({ registeredCount: seated, activeRows: seated });
    } finally {
      await raceApp.close();
      await raceDb.destroy();
    }
  });

  it('R10 rejects invalid capacity change input', async () => {
    const owner = await createUser(db, ['organizer']);
    const event = await createEventAs(owner, { capacity: 3 });
    const cases: [Record<string, unknown>, string][] = [
      [{ capacity: 0 }, 'capacity'],
      [{ capacity: 501 }, 'capacity'],
      [{ capacity: 2.5 }, 'capacity'],
      [{ capacity: '5' }, 'capacity'],
      [{}, 'capacity'],
      [{ capacity: 5, title: 'New title' }, 'body'],
    ];
    for (const [payload, field] of cases) {
      const res = await app.inject({ method: 'PATCH', url: `/v1/events/${event.id}`, headers: as(owner), payload });
      const label = JSON.stringify(payload);
      expect(res.statusCode, label).toBe(400);
      expect(res.json<Problem>().code, label).toBe('VALIDATION_FAILED');
      expect(res.json<Problem>().errors?.map((error) => error.field), label).toContain(field);
    }
    const unchanged = await app.inject({ method: 'GET', url: `/v1/events/${event.id}`, headers: as(owner) });
    expect(unchanged.json<EventView>().capacity).toBe(3);

    // The limits themselves are allowed, so a rule that is too strict fails too.
    for (const capacity of [1, 500]) {
      const res = await setCapacity(event.id, owner, capacity);
      expect(res.statusCode, String(capacity)).toBe(200);
      expect(res.json<EventView>().capacity).toBe(capacity);
    }
  });
});

describe('reading', () => {
  it('lists events that have not started, soonest first, and only your own with organizer=me', async () => {
    const organizer = await createUser(db, ['organizer']);
    const later = await createEventAs(organizer, { inHours: 2 });
    const sooner = await createEventAs(organizer, { inHours: 1 });
    const started = await createEventAs(organizer, { inHours: 3 });
    await moveToPast(started.id);
    const someoneElses = await createEventAs(await createUser(db, ['organizer']), { inHours: 1 });

    expect(await listIds('organizer=me', organizer)).toEqual([sooner.id, later.id]);
    expect(await listIds('organizer=me&limit=1', organizer)).toEqual([sooner.id]);

    const ids = await listIds('limit=50', await createUser(db));
    for (const id of [sooner.id, later.id, someoneElses.id]) expect(ids).toContain(id);
    expect(ids).not.toContain(started.id);
    expect(ids.indexOf(sooner.id)).toBeLessThan(ids.indexOf(later.id));
  });

  it('shows past events only to admins, with scope=past, newest first', async () => {
    const denied = await app.inject({ method: 'GET', url: '/v1/events?scope=past', headers: as(await createUser(db)) });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<Problem>().code).toBe('FORBIDDEN');

    // Owning the events does not unlock past ones: scope=past is for admins.
    const ownerPast = await app.inject({
      method: 'GET',
      url: '/v1/events?scope=past&organizer=me',
      headers: as(await createUser(db, ['organizer'])),
    });
    expect(ownerPast.statusCode).toBe(403);

    // An admin who also organizes: organizer=me keeps the list to this test's events.
    const adminOrganizer = await createUser(db, ['organizer', 'admin']);
    const upcoming = await createEventAs(adminOrganizer);
    const [older, newer] = [await createEventAs(adminOrganizer), await createEventAs(adminOrganizer)];
    await moveToPast(older.id, 2);
    await moveToPast(newer.id, 1);

    expect(await listIds('scope=past&organizer=me', adminOrganizer)).toEqual([newer.id, older.id]);
    expect(await listIds('scope=past&organizer=me&limit=1', adminOrganizer)).toEqual([newer.id]);
    expect(await listIds('organizer=me', adminOrganizer)).toEqual([upcoming.id]);
  });

  it('validates the list query', async () => {
    const who = await createUser(db);
    for (const query of ['limit=0', 'limit=51', 'limit=abc', 'organizer=someone', 'scope=all', 'sort=title']) {
      const res = await app.inject({ method: 'GET', url: `/v1/events?${query}`, headers: as(who) });
      expect(res.statusCode, query).toBe(400);
      expect(res.json<Problem>().code).toBe('VALIDATION_FAILED');
    }
  });

  it('shows your own registrations, newest first, to attendees only', async () => {
    const organizer = await createUser(db, ['organizer']);
    const [first, second] = [await createEventAs(organizer), await createEventAs(organizer)];
    const attendee = await createUser(db);
    for (const event of [first, second]) {
      expect((await registerAs(event.id, attendee)).statusCode).toBe(201);
    }
    await app.inject({ method: 'DELETE', url: `/v1/events/${first.id}/registrations/me`, headers: as(attendee) });

    const res = await app.inject({ method: 'GET', url: '/v1/me/registrations', headers: as(attendee) });
    const rows = res.json<{ registrations: { status: string; event: { id: string } }[] }>().registrations;
    expect(rows.map((r) => [r.event.id, r.status])).toEqual([
      [second.id, 'active'],
      [first.id, 'cancelled'],
    ]);

    const newest = await app.inject({ method: 'GET', url: '/v1/me/registrations?limit=1', headers: as(attendee) });
    const newestIds = newest.json<{ registrations: { event: { id: string } }[] }>().registrations.map((r) => r.event.id);
    expect(newestIds).toEqual([second.id]);
    for (const query of ['limit=0', 'limit=51', 'status=active']) {
      const res = await app.inject({ method: 'GET', url: `/v1/me/registrations?${query}`, headers: as(attendee) });
      expect(res.statusCode, query).toBe(400);
    }

    const organizerView = await app.inject({ method: 'GET', url: '/v1/me/registrations', headers: as(organizer) });
    expect(organizerView.statusCode).toBe(403);
  });

  it('shows the signed-in user, and all users only to admins', async () => {
    const attendee = await createUser(db);
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: as(attendee) });
    expect(me.json()).toMatchObject({ id: attendee, roles: ['attendee'] });

    expect((await app.inject({ method: 'GET', url: '/v1/users', headers: as(attendee) })).statusCode).toBe(403);
    const users = await app.inject({ method: 'GET', url: '/v1/users', headers: as(await createUser(db, ['admin'])) });
    expect(users.statusCode).toBe(200);
    expect(users.json<{ users: { id: string }[] }>().users.map((u) => u.id)).toContain(attendee);
  });
});

describe('privacy', () => {
  interface Call {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    payload?: Record<string, unknown>;
    status: number;
    /** Text the answer must contain, so the email check runs on real data. */
    shows?: string;
  }

  /**
   * An event with an organizer and two registered attendees, an admin, and a
   * supplier's delivery slot with a contractor's order (SPEC section 14).
   */
  async function setup() {
    const organizer = await createUser(db, ['organizer']);
    const [attendee = '', otherAttendee = ''] = await createUsers(db, 2);
    const admin = await createUser(db, ['admin']);
    const supplier = await createUser(db, ['supplier']);
    const contractor = await createUser(db, ['contractor']);
    const everyone = [organizer, attendee, otherAttendee, admin, supplier, contractor];
    const rows = await db.selectFrom('users').select(['id', 'email']).where('id', 'in', everyone).execute();
    const event = await createEventAs(organizer);
    for (const who of [attendee, otherAttendee]) {
      expect((await registerAs(event.id, who)).statusCode).toBe(201);
    }
    const slot = await insertSlot(db, supplier, { ...slotBody, startsAt: new Date(Date.now() + HOUR_MS).toISOString() });
    const order = randomUUID();
    await placeOrder(db, slot, order, contractor, orderBody);
    return { organizer, attendee, otherAttendee, event, slot, order, emails: rows };
  }

  /**
   * Makes every call as `viewer` and checks that no answer contains anyone
   * else's email. The calls must cover every /v1 operation the server
   * answers, so a new endpoint cannot skip the check.
   */
  async function expectNoOtherEmails(viewer: string, setupData: Awaited<ReturnType<typeof setup>>, calls: Call[]) {
    const others = setupData.emails.filter((row) => row.id !== viewer).map((row) => row.email);
    expect(others).toHaveLength(5);
    for (const { status, shows, ...call } of calls) {
      const res = await app.inject({ ...call, headers: as(viewer) });
      const label = `${call.method} ${call.url}`;
      // A failed call has nothing to leak, so the status shows the check saw the real answer.
      expect(res.statusCode, `${label}: ${res.body}`).toBe(status);
      if (shows !== undefined) expect(res.body, label).toContain(shows);
      for (const email of others) expect(res.body, label).not.toContain(email);
    }
    const covered = new Set(
      calls.map((call) =>
        operationOf(call.method, call.url, setupData.event.id, { [setupData.slot]: 'id', [setupData.order]: 'orderId' }),
      ),
    );
    expect(v1Operations(app).filter((operation) => !covered.has(operation))).toEqual([]);
  }

  it("R6 no endpoint shows another user's email to an attendee", async () => {
    const data = await setup();
    const { attendee, organizer, event, slot, order } = data;
    await expectNoOtherEmails(attendee, data, [
      { method: 'GET', url: '/v1/health', status: 200 },
      { method: 'GET', url: '/v1/me', status: 200, shows: attendee },
      { method: 'GET', url: '/v1/users', status: 403 },
      { method: 'GET', url: '/v1/events?limit=50', status: 200, shows: event.id },
      { method: 'GET', url: '/v1/events?scope=past', status: 403 },
      { method: 'POST', url: '/v1/events', payload: eventBody(), status: 403 },
      { method: 'GET', url: `/v1/events/${event.id}`, status: 200, shows: organizer },
      { method: 'PATCH', url: `/v1/events/${event.id}`, payload: { capacity: 9 }, status: 403 },
      { method: 'GET', url: `/v1/events/${event.id}/registrations`, status: 403 },
      { method: 'PUT', url: `/v1/events/${event.id}/registrations/me`, status: 200, shows: event.id },
      { method: 'DELETE', url: `/v1/events/${event.id}/registrations/me`, status: 204 },
      { method: 'GET', url: '/v1/me/registrations', status: 200, shows: event.id },
      { method: 'GET', url: '/v1/slots?limit=50', status: 200, shows: slot },
      { method: 'POST', url: '/v1/slots', payload: { ...slotBody, startsAt: inHours(2) }, status: 403 },
      { method: 'GET', url: `/v1/slots/${slot}`, status: 200, shows: slot },
      { method: 'GET', url: `/v1/slots/${slot}/orders`, status: 403 },
      { method: 'PUT', url: `/v1/slots/${slot}/orders/${order}`, payload: orderBody, status: 403 },
      { method: 'DELETE', url: `/v1/orders/${order}`, status: 403 },
      { method: 'GET', url: '/v1/me/orders', status: 403 },
      { method: 'GET', url: '/v1/jobs', status: 403 },
      { method: 'PUT', url: `/v1/jobs/${order}/driver`, status: 403 },
      { method: 'PUT', url: `/v1/jobs/${order}/delivered`, status: 403 },
    ]);
  });

  it("R6 no endpoint shows another user's email to an organizer", async () => {
    const data = await setup();
    const { organizer, otherAttendee, event, slot, order } = data;
    await expectNoOtherEmails(organizer, data, [
      { method: 'GET', url: '/v1/health', status: 200 },
      { method: 'GET', url: '/v1/me', status: 200, shows: organizer },
      { method: 'GET', url: '/v1/users', status: 403 },
      { method: 'GET', url: '/v1/events?organizer=me', status: 200, shows: event.id },
      { method: 'GET', url: '/v1/events?scope=past', status: 403 },
      { method: 'POST', url: '/v1/events', payload: eventBody(), status: 201, shows: organizer },
      { method: 'GET', url: `/v1/events/${event.id}`, status: 200, shows: event.id },
      { method: 'PATCH', url: `/v1/events/${event.id}`, payload: { capacity: 9 }, status: 200, shows: event.id },
      // The attendee list names the people, without their emails.
      { method: 'GET', url: `/v1/events/${event.id}/registrations`, status: 200, shows: otherAttendee },
      { method: 'PUT', url: `/v1/events/${event.id}/registrations/me`, status: 403 },
      { method: 'DELETE', url: `/v1/events/${event.id}/registrations/me`, status: 403 },
      { method: 'GET', url: '/v1/me/registrations', status: 403 },
      { method: 'GET', url: '/v1/slots?limit=50', status: 200, shows: slot },
      { method: 'POST', url: '/v1/slots', payload: { ...slotBody, startsAt: inHours(2) }, status: 403 },
      { method: 'GET', url: `/v1/slots/${slot}`, status: 200, shows: slot },
      { method: 'GET', url: `/v1/slots/${slot}/orders`, status: 403 },
      { method: 'PUT', url: `/v1/slots/${slot}/orders/${order}`, payload: orderBody, status: 403 },
      { method: 'DELETE', url: `/v1/orders/${order}`, status: 403 },
      { method: 'GET', url: '/v1/me/orders', status: 403 },
      { method: 'GET', url: '/v1/jobs', status: 403 },
      { method: 'PUT', url: `/v1/jobs/${order}/driver`, status: 403 },
      { method: 'PUT', url: `/v1/jobs/${order}/delivered`, status: 403 },
    ]);
  });
});

describe('contract', () => {
  it('lists every /v1 route the server answers', async () => {
    const contract = (await app.inject({ method: 'GET', url: '/openapi.json' })).json<{ paths: Record<string, object> }>();
    const documented = Object.entries(contract.paths)
      .filter(([path]) => path.startsWith('/v1'))
      .flatMap(([path, operations]) => Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`));
    expect(documented.sort()).toEqual(v1Operations(app));
  });
});

describe('health', () => {
  it('R8 health answers without an identity', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', identity: 'dev-stub' });
  });

  it('answers 503 when the database refuses connections', async () => {
    // Nothing listens on port 1, so the connection is refused.
    const deadDb = createDb('postgres://nobody:nothing@127.0.0.1:1/none');
    const deadApp = await buildApp({ db: deadDb, authMode: 'dev-stub', logLevel: 'silent' });
    try {
      const res = await deadApp.inject({ method: 'GET', url: '/v1/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: 'unavailable', db: 'down', identity: 'dev-stub' });
    } finally {
      await deadApp.close();
      await deadDb.destroy();
    }
  });

  it('answers 503 within its time limit when the database hangs', async () => {
    // Accepts connections and never answers, like a database that hangs.
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    const hungDb = createDb(`postgres://nobody:nothing@127.0.0.1:${String(port)}/none`);
    const hungApp = await buildApp({ db: hungDb, authMode: 'dev-stub', logLevel: 'silent' });
    try {
      const startedAt = Date.now();
      const res = await hungApp.inject({ method: 'GET', url: '/v1/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ db: 'down' });
      // The health check's own 5 s limit answered: the connection attempt
      // itself would wait until the server goes away.
      expect(Date.now() - startedAt).toBeLessThan(9000);
    } finally {
      server.close();
      for (const socket of sockets) socket.destroy();
      await hungApp.close();
      await hungDb.destroy();
    }
  });
});
