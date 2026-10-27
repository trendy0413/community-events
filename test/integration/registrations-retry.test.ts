import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cancel, register } from '../../src/modules/registrations/service.js';
import { createEvent, createUser, seatCounts, testDb } from './helpers.js';

// Two failures need exact timing that no lock can produce, so this file
// opens a seam in the repository:
// - the same-person race in SPEC section 8: a cancel commits in the gap
//   between register's INSERT and its follow-up SELECT;
// - a dropped connection in the middle of a register or a cancel.
// Everything else is real SQL on real PostgreSQL.

const seam = vi.hoisted(() => ({
  beforeFind: null as null | (() => Promise<unknown>),
  forceMiss: false,
  dropInsert: false,
  dropCancel: false,
}));

/** What the pg driver throws when the server closes the socket mid-query. */
const connectionDropped = () => new Error('Connection terminated unexpectedly');

vi.mock('../../src/modules/registrations/repository.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/modules/registrations/repository.js')>();
  return {
    ...real,
    insertActiveRegistration: async (...args: Parameters<typeof real.insertActiveRegistration>) => {
      if (seam.dropInsert) {
        seam.dropInsert = false;
        throw connectionDropped();
      }
      return real.insertActiveRegistration(...args);
    },
    findActiveRegistration: async (...args: Parameters<typeof real.findActiveRegistration>) => {
      const before = seam.beforeFind;
      seam.beforeFind = null;
      if (before) await before();
      return seam.forceMiss ? null : real.findActiveRegistration(...args);
    },
    cancelActiveRegistration: async (...args: Parameters<typeof real.cancelActiveRegistration>) => {
      if (seam.dropCancel) {
        seam.dropCancel = false;
        throw connectionDropped();
      }
      return real.cancelActiveRegistration(...args);
    },
  };
});

const db = testDb(5);
afterAll(() => db.destroy());
afterEach(() => {
  Object.assign(seam, { beforeFind: null, forceMiss: false, dropInsert: false, dropCancel: false });
});

const newEvent = async (): Promise<string> => createEvent(db, await createUser(db, ['organizer']), { capacity: 5 });

describe('register retry', () => {
  it("R2 register retries when the same person's cancel commits in between", async () => {
    const eventId = await newEvent();
    const person = await createUser(db);
    const first = await register(db, eventId, person);

    // Second register: its INSERT sees the active row and inserts nothing.
    // Before it reads that row back, the same person's cancel commits on
    // another connection, so the read finds no active row.
    seam.beforeFind = () => cancel(db, eventId, person);
    const second = await register(db, eventId, person);

    // The retry inserted a fresh registration instead of failing.
    expect(second.created).toBe(true);
    expect(second.registration.id).not.toBe(first.registration.id);
    expect(await seatCounts(db, eventId)).toEqual({ registeredCount: 1, activeRows: 1 });
  });

  it('register gives up after 3 attempts instead of looping', async () => {
    const eventId = await newEvent();
    const person = await createUser(db);
    await register(db, eventId, person);

    // Every follow-up read now misses the existing row, as if a cancel had
    // committed each time; the service must stop rather than spin.
    seam.forceMiss = true;
    await expect(register(db, eventId, person)).rejects.toThrow(/gave up after 3 attempts/);
    expect(await seatCounts(db, eventId)).toEqual({ registeredCount: 1, activeRows: 1 });
  });

  it('R2 register is retried once when the database connection drops', async () => {
    const eventId = await newEvent();
    const person = await createUser(db);

    seam.dropInsert = true;
    const result = await register(db, eventId, person);

    expect(result.created).toBe(true);
    expect(await seatCounts(db, eventId)).toEqual({ registeredCount: 1, activeRows: 1 });
  });

  it('R3 cancel is retried once when the database connection drops', async () => {
    const eventId = await newEvent();
    const person = await createUser(db);
    await register(db, eventId, person);

    seam.dropCancel = true;
    expect(await cancel(db, eventId, person)).toEqual({ cancelled: true });
    expect(await seatCounts(db, eventId)).toEqual({ registeredCount: 0, activeRows: 0 });
  });

  it('does not retry an ordinary error', async () => {
    const person = await createUser(db);
    // An unknown event is a NOT_FOUND, not a lost connection: one try only.
    await expect(register(db, '00000000-0000-4000-8000-000000000000', person)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
