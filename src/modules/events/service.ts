import type { Db } from '../../db/client.js';
import { DomainError } from '../../http/errors.js';
import { findCapacityState, updateCapacity } from './repository.js';

/** Attempts in total when a cancel commits between a failed update and the read that explains it (SPEC section 8). */
const MAX_ATTEMPTS = 3;

/**
 * R7: changes an event's capacity. The caller has already passed the owner
 * check (can() in the route).
 */
export async function changeCapacity(db: Db, eventId: string, organizerId: string, capacity: number): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (await updateCapacity(db, eventId, organizerId, capacity)) return;

    // The read runs after the update, so it can see a later state. Each
    // check below explains the failed update only if it still holds.
    const state = await findCapacityState(db, eventId);
    if (!state) throw new DomainError('NOT_FOUND', 'This event does not exist.');
    if (state.organizerId !== organizerId) throw new DomainError('FORBIDDEN', 'You are not allowed to do this.');
    if (state.started) throw new DomainError('EVENT_STARTED', 'This event has started, so its capacity is fixed.');
    if (state.registeredCount > capacity) {
      const count = state.registeredCount;
      throw new DomainError(
        'CAPACITY_BELOW_REGISTERED',
        `${count} ${count === 1 ? 'person is' : 'people are'} registered, so the capacity cannot go below ${count}.`,
      );
    }
    // Nothing explains the failure: a cancel committed after the update
    // checked the count, so the update would pass now.
  }
  // Needs a register and a cancel to commit around every attempt. The error
  // handler logs this and answers INTERNAL_ERROR with a generic detail.
  throw new Error(`changeCapacity: gave up after ${MAX_ATTEMPTS} attempts racing registrations`);
}
