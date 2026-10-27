import type { Db } from '../../db/client.js';
import { isLostConnection } from '../../db/lost-connection.js';
import { DomainError } from '../../http/errors.js';
import {
  cancelBookedOrder,
  claimJob,
  deliverJob,
  findOrder,
  findSlotState,
  freeDelivery,
  insertOrder,
  type OrderRow,
  takeDelivery,
} from './repository.js';
import type { PlaceOrderInput } from './schemas.js';

// Orders and delivery jobs (SPEC section 14, rules S1-S5). Permissions are
// checked before these run (can() in the route).

const FOREIGN_KEY_VIOLATION = '23503';
const SLOT_FOREIGN_KEY = 'orders_slot_id_fkey';

// Thrown inside a transaction to roll it back; never leaves this module.
class NoDeliveryTaken extends Error {}

function isUnknownSlot(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'constraint' in error &&
    error.code === FOREIGN_KEY_VIOLATION &&
    error.constraint === SLOT_FOREIGN_KEY
  );
}

const slotNotFound = () => new DomainError('NOT_FOUND', 'This delivery slot does not exist.');
const orderNotFound = () => new DomainError('NOT_FOUND', 'This order does not exist.');

/**
 * Runs an order write once more if its connection drops. Safe for the same
 * reason as register and cancel: each is idempotent, so a first try that did
 * commit makes the second return the same order.
 */
async function retryOnLostConnection<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isLostConnection(error)) throw error;
    return run();
  }
}

export interface PlaceOrderResult {
  order: OrderRow;
  /** false when this order id was already placed (S2). */
  created: boolean;
}

export async function placeOrder(
  db: Db,
  slotId: string,
  orderId: string,
  contractorId: string,
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  return retryOnLostConnection(() => placeOrderOnce(db, slotId, orderId, contractorId, input));
}

async function placeOrderOnce(
  db: Db,
  slotId: string,
  orderId: string,
  contractorId: string,
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  try {
    return await db.transaction().execute(async (trx) => {
      let inserted: OrderRow | null;
      try {
        inserted = await insertOrder(trx, orderId, slotId, contractorId, input);
      } catch (error) {
        if (isUnknownSlot(error)) throw slotNotFound();
        throw error;
      }

      if (!inserted) {
        // S2: the id exists. A parallel retry waited for the first insert to
        // commit, so the row is visible now. It is a retry of this request
        // only if everything matches; anything else would silently drop the
        // new body, so it is refused.
        const existing = await findOrder(trx, orderId);
        if (
          existing &&
          existing.contractor_id === contractorId &&
          existing.slot_id === slotId &&
          existing.items === input.items &&
          existing.jobsite === input.jobsite
        ) {
          return { order: existing, created: false };
        }
        throw new DomainError('ORDER_ID_IN_USE', 'This order id is already used for another order.');
      }

      if (!(await takeDelivery(trx, slotId))) throw new NoDeliveryTaken();
      return { order: inserted, created: true };
    });
  } catch (error) {
    if (!(error instanceof NoDeliveryTaken)) throw error;
    // Read after the rollback, which also removed the order row.
    const state = await findSlotState(db, slotId);
    if (!state) throw slotNotFound();
    if (state.started) throw new DomainError('SLOT_STARTED', 'This delivery slot has started, so it takes no new orders.');
    throw new DomainError('SLOT_FULL', `All ${state.capacity} deliveries in this slot are booked.`);
  }
}

/** Returns whether an order was cancelled; cancelling twice is not an error (S3). */
export async function cancelOrder(db: Db, orderId: string, contractorId: string): Promise<{ cancelled: boolean }> {
  return retryOnLostConnection(() =>
    db.transaction().execute(async (trx) => {
      const cancelled = await cancelBookedOrder(trx, orderId, contractorId);
      if (!cancelled) {
        const existing = await findOrder(trx, orderId);
        if (!existing) throw orderNotFound();
        if (existing.contractor_id !== contractorId) throw new DomainError('FORBIDDEN', 'You are not allowed to do this.');
        if (existing.status === 'cancelled') return { cancelled: false };
        throw new DomainError('ORDER_CLAIMED', 'A driver has taken this delivery, so it can no longer be cancelled.');
      }
      // Throwing here rolls back the status change too.
      if (!(await freeDelivery(trx, cancelled.slot_id))) {
        throw new DomainError('SLOT_STARTED', 'This delivery slot has started, so it is too late to cancel.');
      }
      return { cancelled: true };
    }),
  );
}

/** S4: the job becomes this driver's, or the answer says why not. Claiming again is not an error. */
export async function claim(db: Db, orderId: string, driverId: string): Promise<void> {
  // Two attempts: if the order was committed between the UPDATE and the read
  // below, it is still open, and trying once more takes it.
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (await claimJob(db, orderId, driverId)) return;
    const existing = await findOrder(db, orderId);
    if (!existing) throw orderNotFound();
    if (existing.driver_id === driverId) return;
    if (existing.driver_id) throw new DomainError('JOB_TAKEN', 'Another driver has taken this delivery.');
    if (existing.status !== 'booked') {
      throw new DomainError('JOB_NOT_OPEN', `This order is ${existing.status}, so it cannot be taken.`);
    }
  }
  throw new Error('claim: an open job could not be taken twice in a row');
}

/** S5: only the driver who has the job marks it delivered. Marking it again is not an error. */
export async function markDelivered(db: Db, orderId: string, driverId: string): Promise<void> {
  if (await deliverJob(db, orderId, driverId)) return;
  const existing = await findOrder(db, orderId);
  if (!existing) throw orderNotFound();
  if (existing.driver_id === driverId && existing.status === 'delivered') return;
  throw new DomainError('FORBIDDEN', 'Only the driver who took this delivery can mark it delivered.');
}
