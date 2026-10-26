import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cancel, register } from '../../src/modules/registrations/service.js';
import { createEvent, createUser, seatCounts, testDb } from './helpers.js';

// The same-person race in SPEC section 8 happens only when a cancel commits
// in the gap between register's INSERT and its follow-up SELECT, a gap of one
// round trip that no lock can hold open. This file opens the gap on purpose:
// it wraps the real SELECT and runs a real cancel just before it. Everything
// else is real SQL on real PostgreSQL.

const seam = vi.hoisted(() => ({
  beforeFind: null as null | (() => Promise<unknown>),
  forceMiss: false,
}));

vi.mock('../../src/modules/registrations/repository.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/modules/registrations/repository.js')>();
  return {
    ...real,
    findActiveRegistration: async (...args: Parameters<typeof real.findActiveRegistration>) => {
      const before = seam.beforeFind;
      seam.beforeFind = null;
      if (before) await before();
      return seam.forceMiss ? null : real.findActiveRegistration(...args);
    },
  };
});

const db = testDb(5);
afterAll(() => db.destroy());
afterEach(() => {
  seam.beforeFind = null;
  seam.forceMiss = false;
});

describe('register retry', () => {
  it("R2 register retries when the same person's cancel commits in between", async () => {
    const eventId = await createEvent(db, await createUser(db, ['organizer']), { capacity: 5 });
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
    const eventId = await createEvent(db, await createUser(db, ['organizer']), { capacity: 5 });
    const person = await createUser(db);
    await register(db, eventId, person);

    // Every follow-up read now misses the existing row, as if a cancel had
    // committed each time; the service must stop rather than spin.
    seam.forceMiss = true;
    await expect(register(db, eventId, person)).rejects.toThrow(/gave up after 3 attempts/);
    expect(await seatCounts(db, eventId)).toEqual({ registeredCount: 1, activeRows: 1 });
  });
});
