import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { findCountDrift } from '../../src/db/count-drift.js';
import { cancel, register } from '../../src/modules/registrations/service.js';
import { insertSlot } from '../../src/modules/supply/repository.js';
import { cancelOrder, placeOrder } from '../../src/modules/supply/service.js';
import { createEvent, createUser, createUsers, testDb } from './helpers.js';

// SPEC section 15. Other test files leave their own rows in this database,
// so each test looks only at the rows it made.
const db = testDb();
afterAll(() => db.destroy());

const DAY_MS = 24 * 60 * 60 * 1000;

async function eventWithRegistrations(count: number): Promise<string> {
  const eventId = await createEvent(db, await createUser(db, ['organizer']));
  if (count === 0) return eventId;
  for (const attendee of await createUsers(db, count)) await register(db, eventId, attendee);
  return eventId;
}

async function slotWithOrders(count: number): Promise<string> {
  const slotId = await insertSlot(db, await createUser(db, ['supplier']), {
    title: 'Morning run',
    area: 'Downtown',
    startsAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
    timezone: 'America/Chicago',
    capacity: 3,
  });
  for (const contractor of await createUsers(db, count, ['contractor'])) {
    await placeOrder(db, slotId, randomUUID(), contractor, { items: 'Two pallets of brick', jobsite: '5 Main St' });
  }
  return slotId;
}

const driftIds = async () => {
  const report = await findCountDrift(db);
  return { events: report.events.map((drift) => drift.id), slots: report.slots.map((drift) => drift.id) };
};

describe('count check', () => {
  it('O3 the count check passes when every count matches', async () => {
    const [eventId, emptyEvent, slotId] = [await eventWithRegistrations(2), await eventWithRegistrations(0), await slotWithOrders(2)];
    // Cancelled rows stay as history and must not count (R3, S3).
    const leaver = await createUser(db);
    await register(db, eventId, leaver);
    await cancel(db, eventId, leaver);
    const contractor = await createUser(db, ['contractor']);
    const cancelledOrder = randomUUID();
    await placeOrder(db, slotId, cancelledOrder, contractor, { items: 'One skip bin', jobsite: '5 Main St' });
    await cancelOrder(db, cancelledOrder, contractor);

    const drift = await driftIds();

    expect(drift.events).not.toContain(eventId);
    expect(drift.events).not.toContain(emptyEvent);
    expect(drift.slots).not.toContain(slotId);
  });

  it('O3 the count check names an event whose count differs', async () => {
    const eventId = await eventWithRegistrations(2);
    // A manual edit behind the registration service: the alert's whole purpose.
    await db.updateTable('events').set({ registered_count: 3 }).where('id', '=', eventId).execute();

    const report = await findCountDrift(db);

    expect(report.events.find((drift) => drift.id === eventId)).toEqual({
      id: eventId,
      title: 'Test event',
      stored: 3,
      rows: 2,
    });
    await db.updateTable('events').set({ registered_count: 2 }).where('id', '=', eventId).execute();
    expect((await driftIds()).events).not.toContain(eventId);
  });

  it('O3 the count check names a slot whose count differs', async () => {
    const slotId = await slotWithOrders(1);
    await db.updateTable('delivery_slots').set({ booked_count: 0 }).where('id', '=', slotId).execute();

    const report = await findCountDrift(db);

    expect(report.slots.find((drift) => drift.id === slotId)).toEqual({
      id: slotId,
      title: 'Morning run',
      stored: 0,
      rows: 1,
    });
    await db.updateTable('delivery_slots').set({ booked_count: 1 }).where('id', '=', slotId).execute();
    expect((await driftIds()).slots).not.toContain(slotId);
  });
});
