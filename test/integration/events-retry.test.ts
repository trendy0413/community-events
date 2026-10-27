import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { changeCapacity } from '../../src/modules/events/service.js';
import { cancel, register } from '../../src/modules/registrations/service.js';
import { createEvent, createUsers, createUser, seatCounts, testDb } from './helpers.js';

// A capacity change explains a failed UPDATE with a second read. A cancel
// that commits between the two needs exact timing that no lock can produce,
// so this file opens a seam in the repository. Everything else is real SQL
// on real PostgreSQL.

const seam = vi.hoisted(() => ({
  afterFailedUpdate: null as null | (() => Promise<unknown>),
  updates: 0,
  hideCount: false,
}));

vi.mock('../../src/modules/events/repository.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/modules/events/repository.js')>();
  return {
    ...real,
    updateCapacity: async (...args: Parameters<typeof real.updateCapacity>) => {
      seam.updates++;
      const changed = await real.updateCapacity(...args);
      const after = seam.afterFailedUpdate;
      if (!changed && after) {
        seam.afterFailedUpdate = null;
        await after();
      }
      return changed;
    },
    findCapacityState: async (...args: Parameters<typeof real.findCapacityState>) => {
      const state = await real.findCapacityState(...args);
      // As if a cancel always landed between the update and this read.
      return state && seam.hideCount ? { ...state, registeredCount: 0 } : state;
    },
  };
});

const db = testDb(5);
afterAll(() => db.destroy());
afterEach(() => {
  Object.assign(seam, { afterFailedUpdate: null, updates: 0, hideCount: false });
});

/** An event with two people registered. */
async function eventWithTwo(): Promise<{ eventId: string; owner: string; people: string[] }> {
  const owner = await createUser(db, ['organizer']);
  const eventId = await createEvent(db, owner, { capacity: 5 });
  const people = await createUsers(db, 2);
  for (const person of people) await register(db, eventId, person);
  return { eventId, owner, people };
}

const capacityOf = async (eventId: string) =>
  (await db.selectFrom('events').select('capacity').where('id', '=', eventId).executeTakeFirstOrThrow()).capacity;

describe('capacity change after a failed update', () => {
  it('R7 capacity change retries when a cancel commits in between', async () => {
    const { eventId, owner, people } = await eventWithTwo();

    // Two are registered, so lowering to 1 fails. Before the failure is
    // explained, one of them cancels: the read now finds 1 registered,
    // which does not explain the failure, so the change runs again.
    seam.afterFailedUpdate = () => cancel(db, eventId, people[0] ?? '');
    await changeCapacity(db, eventId, owner, 1);

    expect(seam.updates).toBe(2);
    expect(await capacityOf(eventId)).toBe(1);
    expect(await seatCounts(db, eventId)).toEqual({ registeredCount: 1, activeRows: 1 });
  });

  it('R5 capacity change checks the owner again in SQL', async () => {
    const { eventId } = await eventWithTwo();
    const someoneElse = await createUser(db, ['organizer']);

    // The route checks the owner first. Calling the service directly reaches
    // the organizer_id guard behind that check: it must refuse, not retry.
    await expect(changeCapacity(db, eventId, someoneElse, 4)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(seam.updates).toBe(1);
    expect(await capacityOf(eventId)).toBe(5);
  });

  it('capacity change gives up after 3 attempts instead of looping', async () => {
    const { eventId, owner } = await eventWithTwo();

    seam.hideCount = true;
    await expect(changeCapacity(db, eventId, owner, 1)).rejects.toThrow(/gave up after 3 attempts/);

    expect(seam.updates).toBe(3);
    expect(await capacityOf(eventId)).toBe(5);
    expect(await seatCounts(db, eventId)).toEqual({ registeredCount: 2, activeRows: 2 });
  });
});
