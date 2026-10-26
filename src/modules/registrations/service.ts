import type { Db } from '../../db/client.js';
import { DomainError } from '../../http/errors.js';
import {
  cancelActiveRegistration,
  findActiveRegistration,
  findEventSeatState,
  freeSeat,
  insertActiveRegistration,
  type Registration,
  takeSeat,
} from './repository.js';

// Register and cancel (SPEC section 8, rules R1-R4). Permissions are checked
// before these run (can() in the route); here the caller is an attendee.

/** Attempts in total for a same-person register/cancel race, first try included (SPEC section 8). */
const MAX_ATTEMPTS = 3;
const FOREIGN_KEY_VIOLATION = '23503';
const EVENT_FOREIGN_KEY = 'registrations_event_id_fkey';

export interface RegisterResult {
  registration: Registration;
  /** false when the person was already registered (R2). */
  created: boolean;
}

// Thrown inside a transaction to roll it back; never leaves this module.
class NoSeatTaken extends Error {}
class CancelledInBetween extends Error {}

function isUnknownEvent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'constraint' in error &&
    error.code === FOREIGN_KEY_VIOLATION &&
    error.constraint === EVENT_FOREIGN_KEY
  );
}

function notFound(): DomainError {
  return new DomainError('NOT_FOUND', 'This event does not exist.');
}

/** Explains a seat that could not be taken. Read after the rollback. */
async function noSeatError(db: Db, eventId: string): Promise<DomainError> {
  const state = await findEventSeatState(db, eventId);
  if (!state) return notFound();
  if (state.started) return new DomainError('EVENT_STARTED', 'This event has started, so registrations are closed.');
  // A seat may have been freed after the failed attempt; the client can try again.
  return new DomainError('EVENT_FULL', `All ${state.capacity} seats are taken.`);
}

export async function register(db: Db, eventId: string, attendeeId: string): Promise<RegisterResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await db.transaction().execute(async (trx) => {
        let inserted: Registration | null;
        try {
          inserted = await insertActiveRegistration(trx, eventId, attendeeId);
        } catch (error) {
          if (isUnknownEvent(error)) throw notFound();
          throw error;
        }

        if (!inserted) {
          // R2: already registered. Return the existing registration, so a
          // retried request gets the same answer.
          const existing = await findActiveRegistration(trx, eventId, attendeeId);
          if (existing) return { registration: existing, created: false };
          // The conflicting row was cancelled after the insert saw it: the
          // same person cancelled at the same moment. Start again.
          throw new CancelledInBetween();
        }

        if (!(await takeSeat(trx, eventId))) throw new NoSeatTaken();
        return { registration: inserted, created: true };
      });
    } catch (error) {
      if (error instanceof CancelledInBetween) continue;
      if (error instanceof NoSeatTaken) throw await noSeatError(db, eventId);
      throw error;
    }
  }
  // Needs three cancels by the same person during one request. The error
  // handler logs this and answers INTERNAL_ERROR with a generic detail.
  throw new Error(`register: gave up after ${MAX_ATTEMPTS} attempts racing the same person's cancels`);
}

/** Returns whether a registration was cancelled; cancelling twice is not an error (R3). */
export async function cancel(db: Db, eventId: string, attendeeId: string): Promise<{ cancelled: boolean }> {
  return db.transaction().execute(async (trx) => {
    const cancelled = await cancelActiveRegistration(trx, eventId, attendeeId);
    if (!cancelled) {
      if (!(await findEventSeatState(trx, eventId))) throw notFound();
      return { cancelled: false };
    }
    // Throwing here rolls back the status change too (R4).
    if (!(await freeSeat(trx, eventId))) {
      throw new DomainError('EVENT_STARTED', 'This event has started, so cancellations are closed.');
    }
    return { cancelled: true };
  });
}
