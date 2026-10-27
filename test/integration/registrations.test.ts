import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { DomainError, type ErrorCode } from '../../src/http/errors.js';
import { cancel, register } from '../../src/modules/registrations/service.js';
import { createEvent, createUser, createUsers, seatCounts, testDb } from './helpers.js';

// The pool is larger than the biggest parallel batch below (50). With a
// smaller pool the calls would queue for a connection and never really race.
const db = testDb(60);
afterAll(() => db.destroy());

const RACE_TIMEOUT_MS = 120_000;
const HOUR_MS = 60 * 60 * 1000;

const newEvent = async (capacity: number, startsAt?: Date): Promise<string> =>
  createEvent(db, await createUser(db, ['organizer']), startsAt ? { capacity, startsAt } : { capacity });

const twoPeople = async (): Promise<[string, string]> => [await createUser(db), await createUser(db)];

function codeOf(result: PromiseSettledResult<unknown>): ErrorCode | 'ok' | 'not a DomainError' {
  if (result.status === 'fulfilled') return 'ok';
  return result.reason instanceof DomainError ? result.reason.code : 'not a DomainError';
}

function tally(results: PromiseSettledResult<unknown>[]): Record<string, number> {
  // An unexpected error fails here with its message, so a failure says what
  // went wrong instead of only that the counts are off.
  const unexpected = results
    .filter((result) => codeOf(result) === 'not a DomainError')
    .map((result) => (result.status === 'rejected' ? String(result.reason) : ''));
  expect(unexpected, 'errors that are not SPEC error codes').toEqual([]);

  const counts: Record<string, number> = {};
  for (const result of results) {
    const code = codeOf(result);
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

async function expectSeats(eventId: string, expected: number): Promise<void> {
  expect(await seatCounts(db, eventId)).toEqual({ registeredCount: expected, activeRows: expected });
}

describe('register and cancel', () => {
  it('R1 rejects registration when the event is full', async () => {
    const eventId = await newEvent(1);
    const [first, second] = await twoPeople();

    await register(db, eventId, first);
    await expect(register(db, eventId, second)).rejects.toMatchObject({ code: 'EVENT_FULL' });
    await expectSeats(eventId, 1);
  });

  it(
    'R1 50 parallel registrations for 10 seats give exactly 10',
    async () => {
      const eventId = await newEvent(10);
      const people = await createUsers(db, 50);

      const results = await Promise.allSettled(people.map((person) => register(db, eventId, person)));

      expect(tally(results)).toEqual({ ok: 10, EVENT_FULL: 40 });
      await expectSeats(eventId, 10);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'R1 R3 mixed registers and cancels keep the count equal to the active rows',
    async () => {
      const eventId = await newEvent(10);
      const holders = await createUsers(db, 10);
      const newcomers = await createUsers(db, 15);
      await Promise.all(holders.map((person) => register(db, eventId, person)));

      // Holders leave while newcomers arrive. Every call starts before any is
      // awaited, so they all compete for the event row at the same time.
      const cancels = holders.map((person) => cancel(db, eventId, person));
      const registers = newcomers.map((person) => register(db, eventId, person));
      const [cancelResults, registerResults] = await Promise.all([
        Promise.allSettled(cancels),
        Promise.allSettled(registers),
      ]);

      // Every holder really left: a cancel that changed nothing would fail here.
      for (const result of cancelResults) {
        expect(result).toEqual({ status: 'fulfilled', value: { cancelled: true } });
      }
      for (const result of registerResults) expect(['ok', 'EVENT_FULL']).toContain(codeOf(result));
      // With all holders gone, the seats taken are exactly the newcomers who got one.
      const { registeredCount, activeRows } = await seatCounts(db, eventId);
      expect(registeredCount).toBe(activeRows);
      expect(registeredCount).toBe(tally(registerResults).ok ?? 0);
      expect(registeredCount).toBeLessThanOrEqual(10);
    },
    RACE_TIMEOUT_MS,
  );

  it('R2 registering twice returns the same registration', async () => {
    const eventId = await newEvent(5);
    const person = await createUser(db);

    const first = await register(db, eventId, person);
    const second = await register(db, eventId, person);

    expect(first.created).toBe(true);
    expect(second).toEqual({ registration: first.registration, created: false });
    await expectSeats(eventId, 1);
  });

  it(
    'R2 10 parallel requests by one person give one registration',
    async () => {
      const eventId = await newEvent(5);
      const person = await createUser(db);

      const results = await Promise.all(Array.from({ length: 10 }, () => register(db, eventId, person)));

      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.registration.id)).size).toBe(1);
      await expectSeats(eventId, 1);
    },
    RACE_TIMEOUT_MS,
  );

  it(
    'R2 parallel register and cancel by one person never return 500',
    async () => {
      const eventId = await newEvent(5);
      const person = await createUser(db);

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? register(db, eventId, person) : cancel(db, eventId, person))),
      );

      // No full event and no start time in play: every call must succeed.
      expect(tally(results)).toEqual({ ok: 10 });
      const { registeredCount, activeRows } = await seatCounts(db, eventId);
      expect(registeredCount).toBe(activeRows);
      expect([0, 1]).toContain(registeredCount);
    },
    RACE_TIMEOUT_MS,
  );

  it('R3 cancel frees the seat', async () => {
    const eventId = await newEvent(1);
    const [holder, waiting] = await twoPeople();
    await register(db, eventId, holder);
    await expect(register(db, eventId, waiting)).rejects.toMatchObject({ code: 'EVENT_FULL' });

    expect(await cancel(db, eventId, holder)).toEqual({ cancelled: true });
    await expectSeats(eventId, 0);

    await register(db, eventId, waiting);
    await expectSeats(eventId, 1);
  });

  it('R3 double cancel frees the seat only once', async () => {
    const eventId = await newEvent(2);
    const [leaving, staying] = await twoPeople();
    await register(db, eventId, leaving);
    await register(db, eventId, staying);

    const both = await Promise.all([cancel(db, eventId, leaving), cancel(db, eventId, leaving)]);
    expect(both.map((result) => result.cancelled).sort()).toEqual([false, true]);
    expect(await cancel(db, eventId, leaving)).toEqual({ cancelled: false });

    await expectSeats(eventId, 1);
  });

  it('R3 can register again after cancelling', async () => {
    const eventId = await newEvent(1);
    const person = await createUser(db);

    const first = await register(db, eventId, person);
    await cancel(db, eventId, person);
    const again = await register(db, eventId, person);

    expect(again.created).toBe(true);
    expect(again.registration.id).not.toBe(first.registration.id);
    const history = await db.selectFrom('registrations').select('status').where('event_id', '=', eventId).execute();
    expect(history.map((row) => row.status).sort()).toEqual(['active', 'cancelled']);
    await expectSeats(eventId, 1);
  });

  it('R4 rejects registration after the event starts', async () => {
    const eventId = await newEvent(5, new Date(Date.now() - HOUR_MS));

    await expect(register(db, eventId, await createUser(db))).rejects.toMatchObject({ code: 'EVENT_STARTED' });
    // The rollback also removed the registration row.
    await expectSeats(eventId, 0);
  });

  it('R4 rejects cancellation after the event starts', async () => {
    const eventId = await newEvent(5);
    const person = await createUser(db);
    await register(db, eventId, person);
    await db.updateTable('events').set({ starts_at: new Date(Date.now() - HOUR_MS) }).where('id', '=', eventId).execute();

    await expect(cancel(db, eventId, person)).rejects.toMatchObject({ code: 'EVENT_STARTED' });
    // The rollback kept the registration active and the seat taken.
    await expectSeats(eventId, 1);
  });

  it('answers NOT_FOUND for an event that does not exist', async () => {
    const person = await createUser(db);

    await expect(register(db, randomUUID(), person)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(cancel(db, randomUUID(), person)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
