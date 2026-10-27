import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/http/errors.js';
import { insertActiveRegistration, takeSeat } from '../../src/modules/registrations/repository.js';
import { register } from '../../src/modules/registrations/service.js';
import { createEvent, createUser, seatCounts, testDb } from './helpers.js';

// How the last seat stays safe (SPEC section 8), shown step by step: booking
// A takes the last seat and holds its transaction open; booking B must wait
// on the event row, and only then learn whether the seat is still there.
// The race tests show the totals; these show the wait itself.

const db = testDb();
afterAll(() => db.destroy());

const WAIT_LIMIT_MS = 15_000;

/**
 * Booking A: the same steps as the register service, on one connection,
 * left uncommitted until `finish` is called.
 */
async function holdLastSeat(eventId: string, attendeeId: string) {
  let finish: (commit: boolean) => void = () => undefined;
  const decided = new Promise<boolean>((resolve) => (finish = resolve));
  let pid = 0;
  let ready: () => void = () => undefined;
  const holding = new Promise<void>((resolve) => (ready = resolve));

  const done = db
    .transaction()
    .execute(async (trx) => {
      pid = (await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(trx)).rows[0]?.pid ?? 0;
      await insertActiveRegistration(trx, eventId, attendeeId);
      expect(await takeSeat(trx, eventId)).toBe(true);
      ready();
      // Throwing rolls the transaction back.
      if (!(await decided)) throw new RolledBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error;
    });
  await holding;
  return { pid: () => pid, finish, done };
}

class RolledBack extends Error {}

/** Waits until some other connection is blocked by the given backend. */
async function waitUntilBlockedBy(pid: number): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const { rows } = await sql<{ waiting: number }>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE ${pid} = ANY (pg_blocking_pids(pid))`.execute(db);
    if ((rows[0]?.waiting ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error(`no connection waited for backend ${pid}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('lock wait on the last seat', () => {
  it('R1 a second booking waits for the first and is told full when the first commits', async () => {
    const event = await createEvent(db, await createUser(db, ['organizer']), { capacity: 1 });
    const [a, b] = [await createUser(db), await createUser(db)];

    const first = await holdLastSeat(event, a);
    const second = register(db, event, b).then(
      () => 'seat',
      (error: unknown) => (error instanceof DomainError ? error.code : String(error)),
    );
    await waitUntilBlockedBy(first.pid());
    first.finish(true);
    await first.done;

    expect(await second).toBe('EVENT_FULL');
    expect(await seatCounts(db, event)).toEqual({ registeredCount: 1, activeRows: 1 });
  });

  it('R1 a second booking waits for the first and gets the seat when the first rolls back', async () => {
    const event = await createEvent(db, await createUser(db, ['organizer']), { capacity: 1 });
    const [a, b] = [await createUser(db), await createUser(db)];

    const first = await holdLastSeat(event, a);
    const second = register(db, event, b);
    await waitUntilBlockedBy(first.pid());
    first.finish(false);
    await first.done;

    expect((await second).created).toBe(true);
    expect(await seatCounts(db, event)).toEqual({ registeredCount: 1, activeRows: 1 });
  });
});
