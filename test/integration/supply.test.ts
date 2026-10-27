import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/http/app.js';
import { DomainError, type ErrorCode, type Problem } from '../../src/http/errors.js';
import type { Role } from '../../src/db/schema.js';
import { insertSlot } from '../../src/modules/supply/repository.js';
import { cancelOrder, claim, markDelivered, placeOrder } from '../../src/modules/supply/service.js';
import type { SlotView } from '../../src/modules/supply/schemas.js';
import { createUser, createUsers, operationOf, testDb, v1Operations } from './helpers.js';

// SPEC section 14. The pool is larger than the biggest parallel batch (50),
// so the calls really race instead of queueing for a connection.
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
const order = { items: '20 bags of concrete mix', jobsite: '12 Harbor St, gate B' };

const slotBody = (capacity = 3) => ({
  title: 'Morning run',
  area: 'Downtown',
  startsAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
  timezone: 'America/Chicago',
  capacity,
});

async function newSlot(capacity: number, supplierId?: string): Promise<string> {
  const supplier = supplierId ?? (await createUser(db, ['supplier']));
  return insertSlot(db, supplier, slotBody(capacity));
}

const people = (count: number, role: Role) => createUsers(db, count, [role]);

function codeOf(result: PromiseSettledResult<unknown>): ErrorCode | 'ok' | 'not a DomainError' {
  if (result.status === 'fulfilled') return 'ok';
  return result.reason instanceof DomainError ? result.reason.code : 'not a DomainError';
}

function tally(results: PromiseSettledResult<unknown>[]): Record<string, number> {
  const unexpected = results
    .filter((result) => codeOf(result) === 'not a DomainError')
    .map((result) => (result.status === 'rejected' ? String(result.reason) : ''));
  expect(unexpected).toEqual([]);
  const counts: Record<string, number> = {};
  for (const result of results) counts[codeOf(result)] = (counts[codeOf(result)] ?? 0) + 1;
  return counts;
}

/** The slot's stored count and its real number of orders that are not cancelled. Always equal. */
async function slotCounts(slotId: string): Promise<{ bookedCount: number; liveOrders: number }> {
  const slot = await db.selectFrom('delivery_slots').select('booked_count').where('id', '=', slotId).executeTakeFirstOrThrow();
  const { live } = await db
    .selectFrom('orders')
    .select((eb) => eb.fn.countAll<string>().as('live'))
    .where('slot_id', '=', slotId)
    .where('status', '!=', 'cancelled')
    .executeTakeFirstOrThrow();
  return { bookedCount: slot.booked_count, liveOrders: Number(live) };
}

/** Moves a slot's start into the past (the API never accepts a past start). */
const moveSlotToPast = (slotId: string) =>
  db.updateTable('delivery_slots').set({ starts_at: new Date(Date.now() - DAY_MS) }).where('id', '=', slotId).execute();

async function expectCount(slotId: string, count: number): Promise<void> {
  expect(await slotCounts(slotId)).toEqual({ bookedCount: count, liveOrders: count });
}

describe('orders', () => {
  it('S1 rejects an order when the slot is full', async () => {
    const slot = await newSlot(1);
    const [first = '', second = ''] = await people(2, 'contractor');

    await placeOrder(db, slot, randomUUID(), first, order);
    await expect(placeOrder(db, slot, randomUUID(), second, order)).rejects.toMatchObject({ code: 'SLOT_FULL' });

    await expectCount(slot, 1);
  });

  it('S1 50 parallel orders for 5 deliveries give exactly 5', async () => {
    const slot = await newSlot(5);
    const contractors = await people(50, 'contractor');

    const results = await Promise.allSettled(contractors.map((c) => placeOrder(db, slot, randomUUID(), c, order)));

    expect(tally(results)).toEqual({ ok: 5, SLOT_FULL: 45 });
    await expectCount(slot, 5);
  }, 120_000);

  it('S2 sending the same order twice books it once', async () => {
    const slot = await newSlot(3);
    const contractor = await createUser(db, ['contractor']);
    const id = randomUUID();

    const first = await placeOrder(db, slot, id, contractor, order);
    const again = await placeOrder(db, slot, id, contractor, order);

    expect([first.created, again.created]).toEqual([true, false]);
    expect(again.order.id).toBe(id);
    await expectCount(slot, 1);
  });

  it('S2 10 parallel retries of one order book it once', async () => {
    const slot = await newSlot(3);
    const contractor = await createUser(db, ['contractor']);
    const id = randomUUID();

    const results = await Promise.all(Array.from({ length: 10 }, () => placeOrder(db, slot, id, contractor, order)));

    expect(results.filter((result) => result.created)).toHaveLength(1);
    await expectCount(slot, 1);
  });

  it('S2 an order id cannot be reused for another order', async () => {
    const [slot, otherSlot] = [await newSlot(3), await newSlot(3)];
    const [owner = '', other = ''] = await people(2, 'contractor');
    const id = randomUUID();
    await placeOrder(db, slot, id, owner, order);

    await expect(placeOrder(db, slot, id, other, order)).rejects.toMatchObject({ code: 'ORDER_ID_IN_USE' });
    await expect(placeOrder(db, otherSlot, id, owner, order)).rejects.toMatchObject({ code: 'ORDER_ID_IN_USE' });
    // A "retry" with a different body would silently drop the new body.
    await expect(placeOrder(db, slot, id, owner, { ...order, items: 'Something else' })).rejects.toMatchObject({
      code: 'ORDER_ID_IN_USE',
    });

    await expectCount(slot, 1);
    await expectCount(otherSlot, 0);
  });

  it('S3 cancel frees the capacity once', async () => {
    const slot = await newSlot(1);
    const [first = '', waiting = ''] = await people(2, 'contractor');
    const id = randomUUID();
    await placeOrder(db, slot, id, first, order);

    expect(await cancelOrder(db, id, first)).toEqual({ cancelled: true });
    expect(await cancelOrder(db, id, first)).toEqual({ cancelled: false });
    await expectCount(slot, 0);

    await placeOrder(db, slot, randomUUID(), waiting, order);
    await expectCount(slot, 1);
  });

  it('S1 rejects an order after the slot starts', async () => {
    const slot = await newSlot(3);
    await moveSlotToPast(slot);

    await expect(placeOrder(db, slot, randomUUID(), await createUser(db, ['contractor']), order)).rejects.toMatchObject({
      code: 'SLOT_STARTED',
    });
    await expectCount(slot, 0);
  });

  it('S3 rejects cancellation after the slot starts', async () => {
    const slot = await newSlot(3);
    const contractor = await createUser(db, ['contractor']);
    const id = randomUUID();
    await placeOrder(db, slot, id, contractor, order);
    await moveSlotToPast(slot);

    await expect(cancelOrder(db, id, contractor)).rejects.toMatchObject({ code: 'SLOT_STARTED' });
    // The rollback kept the order and its delivery.
    await expectCount(slot, 1);
  });

  it('S3 cannot cancel after a driver claimed the order', async () => {
    const slot = await newSlot(2);
    const contractor = await createUser(db, ['contractor']);
    const driver = await createUser(db, ['driver']);
    const id = randomUUID();
    await placeOrder(db, slot, id, contractor, order);
    await claim(db, id, driver);

    await expect(cancelOrder(db, id, contractor)).rejects.toMatchObject({ code: 'ORDER_CLAIMED' });
    await expectCount(slot, 1);
  });
});

describe('delivery jobs', () => {
  async function bookedJob(): Promise<{ slot: string; id: string; contractor: string }> {
    const slot = await newSlot(3);
    const contractor = await createUser(db, ['contractor']);
    const id = randomUUID();
    await placeOrder(db, slot, id, contractor, order);
    return { slot, id, contractor };
  }

  const jobRow = (id: string) =>
    db.selectFrom('orders').select(['status', 'driver_id']).where('id', '=', id).executeTakeFirstOrThrow();

  it('S4 10 drivers claiming one job at once: exactly one gets it', async () => {
    const { slot, id } = await bookedJob();
    const drivers = await people(10, 'driver');

    const results = await Promise.allSettled(drivers.map((driver) => claim(db, id, driver)));

    expect(tally(results)).toEqual({ ok: 1, JOB_TAKEN: 9 });
    const winner = drivers[results.findIndex((result) => result.status === 'fulfilled')];
    expect(await jobRow(id)).toEqual({ status: 'claimed', driver_id: winner });
    await expectCount(slot, 1);
  });

  it('S4 the same driver claiming twice keeps the job', async () => {
    const { id } = await bookedJob();
    const [driver = '', other = ''] = await people(2, 'driver');

    await claim(db, id, driver);
    await claim(db, id, driver);
    await expect(claim(db, id, other)).rejects.toMatchObject({ code: 'JOB_TAKEN' });

    expect(await jobRow(id)).toEqual({ status: 'claimed', driver_id: driver });
  });

  it('S3 S4 a parallel cancel and claim: exactly one wins', async () => {
    // Both wait for the order row and re-check status = 'booked', so either
    // the cancel or the claim goes through, never both. Several rounds, so
    // both orders of arrival are likely to run.
    for (let round = 0; round < 5; round++) {
      const { slot, id, contractor } = await bookedJob();
      const driver = await createUser(db, ['driver']);

      const [cancelled, claimed] = await Promise.allSettled([cancelOrder(db, id, contractor), claim(db, id, driver)]);

      const outcome = [codeOf(cancelled), codeOf(claimed)];
      expect([
        ['ok', 'JOB_NOT_OPEN'],
        ['ORDER_CLAIMED', 'ok'],
      ]).toContainEqual(outcome);
      const row = await jobRow(id);
      expect(row.status).toBe(outcome[0] === 'ok' ? 'cancelled' : 'claimed');
      await expectCount(slot, outcome[0] === 'ok' ? 0 : 1);
    }
  });

  it('S4 a cancelled order cannot be claimed', async () => {
    const { id, contractor } = await bookedJob();
    await cancelOrder(db, id, contractor);

    await expect(claim(db, id, await createUser(db, ['driver']))).rejects.toMatchObject({ code: 'JOB_NOT_OPEN' });
  });

  it('S5 only the claiming driver can mark a job delivered', async () => {
    const { id } = await bookedJob();
    const [driver = '', other = ''] = await people(2, 'driver');
    await expect(markDelivered(db, id, driver)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await claim(db, id, driver);

    await expect(markDelivered(db, id, other)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await markDelivered(db, id, driver);
    await markDelivered(db, id, driver);

    expect(await jobRow(id)).toEqual({ status: 'delivered', driver_id: driver });
  });
});

describe('supply over HTTP', () => {
  async function createSlotAs(supplier: string, capacity = 3): Promise<SlotView> {
    const res = await app.inject({ method: 'POST', url: '/v1/slots', headers: as(supplier), payload: slotBody(capacity) });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<SlotView>();
  }

  it('S6 a contractor cannot publish a slot', async () => {
    const contractor = await createUser(db, ['contractor']);
    const supplier = await createUser(db, ['supplier']);

    const refused = await app.inject({ method: 'POST', url: '/v1/slots', headers: as(contractor), payload: slotBody() });
    expect(refused.statusCode).toBe(403);
    expect(refused.json<Problem>().code).toBe('FORBIDDEN');

    const created = await app.inject({ method: 'POST', url: '/v1/slots', headers: as(supplier), payload: slotBody() });
    expect(created.statusCode).toBe(201);
    expect(created.headers.location).toBe(`/v1/slots/${created.json<SlotView>().id}`);
  });

  it("S6 a supplier cannot see another supplier's orders", async () => {
    const [owner = '', other = ''] = await people(2, 'supplier');
    const admin = await createUser(db, ['admin']);
    const slot = await createSlotAs(owner);
    const url = `/v1/slots/${slot.id}/orders`;

    expect((await app.inject({ method: 'GET', url, headers: as(other) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url, headers: as(owner) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url, headers: as(admin) })).statusCode).toBe(200);
  });

  it('S6 only contractors can place an order', async () => {
    const supplier = await createUser(db, ['supplier']);
    const slot = await createSlotAs(supplier);
    const driver = await createUser(db, ['driver']);

    for (const who of [supplier, driver]) {
      const res = await app.inject({
        method: 'PUT',
        url: `/v1/slots/${slot.id}/orders/${randomUUID()}`,
        headers: as(who),
        payload: order,
      });
      expect(res.statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: `/v1/slots/${slot.id}`, headers: as(driver) })).json<SlotView>().bookedCount).toBe(0);
  });

  it('S6 only drivers can claim a job', async () => {
    const supplier = await createUser(db, ['supplier']);
    const contractor = await createUser(db, ['contractor']);
    const slot = await createSlotAs(supplier);
    const id = randomUUID();
    await placeOrder(db, slot.id, id, contractor, order);

    for (const who of [supplier, contractor]) {
      const res = await app.inject({ method: 'PUT', url: `/v1/jobs/${id}/driver`, headers: as(who) });
      expect(res.statusCode).toBe(403);
    }
    const driver = await createUser(db, ['driver']);
    expect((await app.inject({ method: 'PUT', url: `/v1/jobs/${id}/driver`, headers: as(driver) })).statusCode).toBe(200);
  });

  it("S7 no supply endpoint shows another user's email to a contractor, driver or supplier", async () => {
    const supplier = await createUser(db, ['supplier']);
    const [contractor = '', otherContractor = ''] = await people(2, 'contractor');
    const [driver = '', otherDriver = ''] = await people(2, 'driver');
    const slot = await createSlotAs(supplier);
    const [mine, theirs, claimed] = [randomUUID(), randomUUID(), randomUUID()];
    await placeOrder(db, slot.id, mine, contractor, order);
    await placeOrder(db, slot.id, theirs, otherContractor, order);
    await placeOrder(db, slot.id, claimed, otherContractor, order);
    await claim(db, claimed, otherDriver);
    const everyone = [supplier, contractor, otherContractor, driver, otherDriver];
    const emails = await db.selectFrom('users').select(['id', 'email']).where('id', 'in', everyone).execute();

    type Call = { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: object; status: number; shows?: string };
    const check = async (viewer: string, calls: Call[]) => {
      const others = emails.filter((row) => row.id !== viewer).map((row) => row.email);
      for (const { status, shows, ...call } of calls) {
        const res = await app.inject({ ...call, headers: as(viewer) });
        const label = `${call.method} ${call.url}`;
        expect(res.statusCode, `${label}: ${res.body}`).toBe(status);
        if (shows !== undefined) expect(res.body, label).toContain(shows);
        for (const email of others) expect(res.body, label).not.toContain(email);
      }
      return calls;
    };

    const asContractor = await check(contractor, [
      { method: 'GET', url: '/v1/slots?limit=50', status: 200, shows: slot.id },
      { method: 'GET', url: `/v1/slots/${slot.id}`, status: 200, shows: supplier },
      { method: 'POST', url: '/v1/slots', payload: slotBody(), status: 403 },
      { method: 'GET', url: `/v1/slots/${slot.id}/orders`, status: 403 },
      { method: 'PUT', url: `/v1/slots/${slot.id}/orders/${mine}`, payload: order, status: 200, shows: mine },
      { method: 'GET', url: '/v1/me/orders', status: 200, shows: mine },
      { method: 'GET', url: '/v1/jobs', status: 403 },
      { method: 'PUT', url: `/v1/jobs/${mine}/driver`, status: 403 },
      { method: 'PUT', url: `/v1/jobs/${mine}/delivered`, status: 403 },
      // Someone else's order: refused, and nothing about it shown.
      { method: 'DELETE', url: `/v1/orders/${theirs}`, status: 403 },
      { method: 'DELETE', url: `/v1/orders/${mine}`, status: 204 },
    ]);
    // A contractor's list holds only their own orders.
    const myOrders = await app.inject({ method: 'GET', url: '/v1/me/orders', headers: as(contractor) });
    expect(myOrders.body).not.toContain(theirs);

    await check(driver, [
      // Open jobs show the items and the jobsite, never the contractor.
      { method: 'GET', url: '/v1/jobs', status: 200, shows: theirs },
      { method: 'PUT', url: `/v1/jobs/${theirs}/driver`, status: 200, shows: theirs },
      { method: 'PUT', url: `/v1/jobs/${theirs}/delivered`, status: 200, shows: 'delivered' },
      { method: 'GET', url: `/v1/slots/${slot.id}/orders`, status: 403 },
    ]);
    const jobs = await app.inject({ method: 'GET', url: '/v1/jobs', headers: as(driver) });
    expect(jobs.body).not.toContain(otherContractor);

    // The supplier sees the contractors' names on their own slot's orders, not their emails.
    await check(supplier, [
      { method: 'GET', url: `/v1/slots/${slot.id}/orders`, status: 200, shows: otherContractor },
      { method: 'GET', url: '/v1/slots?supplier=me', status: 200, shows: slot.id },
      { method: 'GET', url: '/v1/me/orders', status: 403 },
    ]);

    // The contractor's calls name every supply operation, so a new one cannot skip this check.
    const covered = new Set(asContractor.map((call) => operationOf(call.method, call.url, slot.id, { [mine]: 'orderId', [theirs]: 'orderId' })));
    const supply = v1Operations(app).filter((operation) => /\/v1\/(slots|orders|me\/orders|jobs)/.test(operation));
    expect(supply.filter((operation) => !covered.has(operation))).toEqual([]);
  });

  it('S8 rejects invalid slot input', async () => {
    const supplier = await createUser(db, ['supplier']);
    const cases: [string, Record<string, unknown>, string][] = [
      ['title too short', { ...slotBody(), title: 'ab' }, 'title'],
      ['title too long', { ...slotBody(), title: 'x'.repeat(81) }, 'title'],
      ['area too short', { ...slotBody(), area: 'x' }, 'area'],
      ['area with a NUL character', { ...slotBody(), area: 'Down\u0000town' }, 'area'],
      ['area too long', { ...slotBody(), area: 'x'.repeat(81) }, 'area'],
      ['title with a NUL character', { ...slotBody(), title: 'Morning\u0000run' }, 'title'],
      ['start a year away', { ...slotBody(), startsAt: new Date(Date.now() + 366 * DAY_MS).toISOString() }, 'startsAt'],
      ['capacity zero', { ...slotBody(), capacity: 0 }, 'capacity'],
      ['capacity above 50', { ...slotBody(), capacity: 51 }, 'capacity'],
      ['start in the past', { ...slotBody(), startsAt: new Date(Date.now() - DAY_MS).toISOString() }, 'startsAt'],
      ['start without offset', { ...slotBody(), startsAt: '2027-01-15T07:00:00' }, 'startsAt'],
      ['unknown time zone', { ...slotBody(), timezone: 'Mars/Olympus_Mons' }, 'timezone'],
      ['unknown field', { ...slotBody(), price: 10 }, 'body'],
    ];
    for (const [name, payload, field] of cases) {
      const res = await app.inject({ method: 'POST', url: '/v1/slots', headers: as(supplier), payload });
      expect(res.statusCode, name).toBe(400);
      expect(res.json<Problem>().errors?.map((error) => error.field), name).toContain(field);
    }
    // The limits themselves are allowed.
    for (const capacity of [1, 50]) {
      const res = await app.inject({ method: 'POST', url: '/v1/slots', headers: as(supplier), payload: slotBody(capacity) });
      expect(res.statusCode, `capacity ${capacity}`).toBe(201);
    }
  });

  it('S8 rejects invalid order input', async () => {
    const slot = await createSlotAs(await createUser(db, ['supplier']));
    const contractor = await createUser(db, ['contractor']);
    const cases: [string, Record<string, unknown>, string][] = [
      ['items too short', { ...order, items: 'ab' }, 'items'],
      ['items too long', { ...order, items: 'x'.repeat(501) }, 'items'],
      ['jobsite too short', { ...order, jobsite: 'ab' }, 'jobsite'],
      ['jobsite too long', { ...order, jobsite: 'x'.repeat(201) }, 'jobsite'],
      ['items with a NUL character', { ...order, items: 'nails\u0000' }, 'items'],
      ['jobsite with a NUL character', { ...order, jobsite: 'gate\u0000B' }, 'jobsite'],
      ['unknown field', { ...order, price: 10 }, 'body'],
    ];
    for (const [name, payload, field] of cases) {
      const res = await app.inject({
        method: 'PUT',
        url: `/v1/slots/${slot.id}/orders/${randomUUID()}`,
        headers: as(contractor),
        payload,
      });
      expect(res.statusCode, name).toBe(400);
      expect(res.json<Problem>().errors?.map((error) => error.field), name).toContain(field);
    }
    const accepted = await app.inject({
      method: 'PUT',
      url: `/v1/slots/${slot.id}/orders/${randomUUID()}`,
      headers: as(contractor),
      payload: { items: 'x'.repeat(500), jobsite: 'y'.repeat(200) },
    });
    expect(accepted.statusCode).toBe(201);
  });
});
