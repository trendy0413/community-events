import { type Kysely, type Selectable, sql, type Transaction } from 'kysely';
import type { OwnedResource } from '../../auth/policy.js';
import type { Db } from '../../db/client.js';
import type { Database, OrdersTable } from '../../db/schema.js';
import type { CreateSlotInput, JobView, OrderView, PlaceOrderInput, SlotOrders, SlotView } from './schemas.js';

// The SQL behind SPEC section 14. The writes on booked_count run inside a
// transaction that the supply service opens; these are the only queries
// that change it. Lock order, as for registrations: the order row first,
// then the slot row.

type Trx = Transaction<Database>;
export type OrderRow = Selectable<OrdersTable>;

export async function insertSlot(db: Db, supplierId: string, input: CreateSlotInput): Promise<string> {
  const { id } = await db
    .insertInto('delivery_slots')
    .values({
      supplier_id: supplierId,
      title: input.title,
      area: input.area,
      starts_at: input.startsAt,
      timezone: input.timezone,
      capacity: input.capacity,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

function slotViews(db: Kysely<Database>) {
  return db
    .selectFrom('delivery_slots as s')
    .innerJoin('users as sup', 'sup.id', 's.supplier_id')
    .select([
      's.id',
      's.title',
      's.area',
      's.starts_at',
      's.timezone',
      's.capacity',
      's.booked_count',
      'sup.id as supplier_id',
      'sup.name as supplier_name',
    ]);
}

type SlotViewRow = Awaited<ReturnType<ReturnType<typeof slotViews>['executeTakeFirstOrThrow']>>;

function toSlotView(row: SlotViewRow): SlotView {
  return {
    id: row.id,
    title: row.title,
    area: row.area,
    startsAt: row.starts_at.toISOString(),
    timezone: row.timezone,
    capacity: row.capacity,
    bookedCount: row.booked_count,
    deliveriesLeft: row.capacity - row.booked_count,
    supplier: { id: row.supplier_id, name: row.supplier_name },
  };
}

export async function findSlotView(db: Db, slotId: string): Promise<SlotView | null> {
  const row = await slotViews(db).where('s.id', '=', slotId).executeTakeFirst();
  return row ? toSlotView(row) : null;
}

/** Upcoming slots, soonest first; the id breaks ties so the order is stable. */
export async function listSlotViews(db: Db, filter: { supplierId?: string; limit: number }): Promise<SlotView[]> {
  let query = slotViews(db).where('s.starts_at', '>', sql<Date>`now()`);
  if (filter.supplierId) query = query.where('s.supplier_id', '=', filter.supplierId);
  const rows = await query.orderBy('s.starts_at').orderBy('s.id').limit(filter.limit).execute();
  return rows.map(toSlotView);
}

/** Who owns the slot, for permission checks. */
export async function findSlotOwner(db: Db, slotId: string): Promise<OwnedResource | null> {
  const row = await db.selectFrom('delivery_slots').select('supplier_id').where('id', '=', slotId).executeTakeFirst();
  return row ? { ownerId: row.supplier_id } : null;
}

/** Order step 1: insert the order under the client's id, or nothing if that id exists (S2). */
export async function insertOrder(
  trx: Trx,
  orderId: string,
  slotId: string,
  contractorId: string,
  input: PlaceOrderInput,
): Promise<OrderRow | null> {
  const row = await trx
    .insertInto('orders')
    .values({ id: orderId, slot_id: slotId, contractor_id: contractorId, items: input.items, jobsite: input.jobsite })
    .onConflict((oc) => oc.column('id').doNothing())
    .returningAll()
    .executeTakeFirst();
  return row ?? null;
}

export async function findOrder(db: Kysely<Database>, orderId: string): Promise<OrderRow | null> {
  return (await db.selectFrom('orders').selectAll().where('id', '=', orderId).executeTakeFirst()) ?? null;
}

/**
 * Order step 2 (S1): take one delivery if one is left and the slot has not
 * started. As for takeSeat, the WHERE is checked again after waiting for
 * another transaction's lock on this row, with the clock at that moment.
 */
export async function takeDelivery(trx: Trx, slotId: string): Promise<boolean> {
  const row = await trx
    .updateTable('delivery_slots')
    .set((eb) => ({ booked_count: eb('booked_count', '+', 1) }))
    .where('id', '=', slotId)
    .whereRef('booked_count', '<', 'capacity')
    .where('starts_at', '>', sql<Date>`clock_timestamp()`)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

export async function findSlotState(db: Db, slotId: string): Promise<{ started: boolean; capacity: number } | null> {
  const row = await db
    .selectFrom('delivery_slots')
    .select(['capacity', sql<boolean>`starts_at <= clock_timestamp()`.as('started')])
    .where('id', '=', slotId)
    .executeTakeFirst();
  return row ?? null;
}

/** Cancel step 1 (S3): only a booked order nobody has claimed, and only by its contractor. */
export async function cancelBookedOrder(trx: Trx, orderId: string, contractorId: string): Promise<OrderRow | null> {
  const row = await trx
    .updateTable('orders')
    .set({ status: 'cancelled', cancelled_at: sql<Date>`now()` })
    .where('id', '=', orderId)
    .where('contractor_id', '=', contractorId)
    .where('status', '=', 'booked')
    .returningAll()
    .executeTakeFirst();
  return row ?? null;
}

/** Cancel step 2: give the delivery back, only before the slot starts; called only after step 1 changed a row. */
export async function freeDelivery(trx: Trx, slotId: string): Promise<boolean> {
  const row = await trx
    .updateTable('delivery_slots')
    .set((eb) => ({ booked_count: eb('booked_count', '-', 1) }))
    .where('id', '=', slotId)
    .where('starts_at', '>', sql<Date>`clock_timestamp()`)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * S4 in one statement: the job goes to this driver only if it is booked and
 * nobody has it. A second claim waits for the first one's row lock, then
 * re-checks the WHERE on the new row and matches nothing.
 */
export async function claimJob(db: Db, orderId: string, driverId: string): Promise<boolean> {
  const row = await db
    .updateTable('orders')
    .set({ status: 'claimed', driver_id: driverId, claimed_at: sql<Date>`now()` })
    .where('id', '=', orderId)
    .where('status', '=', 'booked')
    .where('driver_id', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** S5: only the driver who has the job marks it delivered. */
export async function deliverJob(db: Db, orderId: string, driverId: string): Promise<boolean> {
  const row = await db
    .updateTable('orders')
    .set({ status: 'delivered', delivered_at: sql<Date>`now()` })
    .where('id', '=', orderId)
    .where('driver_id', '=', driverId)
    .where('status', '=', 'claimed')
    .returning('id')
    .executeTakeFirst();
  return row !== undefined;
}

/** Orders with their slot, supplier, contractor and driver, for the read views. */
function orderDetails(db: Kysely<Database>) {
  return db
    .selectFrom('orders as o')
    .innerJoin('delivery_slots as s', 's.id', 'o.slot_id')
    .innerJoin('users as sup', 'sup.id', 's.supplier_id')
    .innerJoin('users as c', 'c.id', 'o.contractor_id')
    .leftJoin('users as d', 'd.id', 'o.driver_id')
    .select([
      'o.id',
      'o.items',
      'o.jobsite',
      'o.status',
      'o.created_at',
      's.id as slot_id',
      's.title as slot_title',
      's.area as slot_area',
      's.starts_at as slot_starts_at',
      's.timezone as slot_timezone',
      'sup.id as supplier_id',
      'sup.name as supplier_name',
      'c.id as contractor_id',
      'c.name as contractor_name',
      'd.id as driver_id',
      'd.name as driver_name',
    ]);
}

type OrderDetailRow = Awaited<ReturnType<ReturnType<typeof orderDetails>['executeTakeFirstOrThrow']>>;

function slotSummary(row: OrderDetailRow): JobView['slot'] {
  return {
    id: row.slot_id,
    title: row.slot_title,
    area: row.slot_area,
    startsAt: row.slot_starts_at.toISOString(),
    timezone: row.slot_timezone,
    supplier: { id: row.supplier_id, name: row.supplier_name },
  };
}

function driverOf(row: OrderDetailRow): JobView['driver'] {
  return row.driver_id && row.driver_name ? { id: row.driver_id, name: row.driver_name } : null;
}

function toOrderView(row: OrderDetailRow): OrderView {
  return {
    id: row.id,
    slot: slotSummary(row),
    items: row.items,
    jobsite: row.jobsite,
    status: row.status,
    driver: driverOf(row),
    createdAt: row.created_at.toISOString(),
  };
}

function toJobView(row: OrderDetailRow): JobView {
  return {
    id: row.id,
    slot: slotSummary(row),
    items: row.items,
    jobsite: row.jobsite,
    status: row.status,
    driver: driverOf(row),
  };
}

export async function findOrderView(db: Db, orderId: string): Promise<OrderView | null> {
  const row = await orderDetails(db).where('o.id', '=', orderId).executeTakeFirst();
  return row ? toOrderView(row) : null;
}

export async function findJobView(db: Db, orderId: string): Promise<JobView | null> {
  const row = await orderDetails(db).where('o.id', '=', orderId).executeTakeFirst();
  return row ? toJobView(row) : null;
}

export async function listMyOrders(db: Db, contractorId: string, limit: number): Promise<OrderView[]> {
  const rows = await orderDetails(db)
    .where('o.contractor_id', '=', contractorId)
    .orderBy('o.created_at', 'desc')
    .orderBy('o.id')
    .limit(limit)
    .execute();
  return rows.map(toOrderView);
}

export async function listSlotOrders(db: Db, slotId: string): Promise<SlotOrders> {
  const rows = await orderDetails(db).where('o.slot_id', '=', slotId).orderBy('o.created_at').execute();
  return {
    orders: rows.map((row) => ({
      id: row.id,
      contractor: { id: row.contractor_id, name: row.contractor_name },
      items: row.items,
      jobsite: row.jobsite,
      status: row.status,
      driver: driverOf(row),
      createdAt: row.created_at.toISOString(),
    })),
  };
}

const JOB_LIST_LIMIT = 50;

/** Jobs nobody has claimed, in slots that have not started, soonest first. */
export async function listOpenJobs(db: Db): Promise<JobView[]> {
  const rows = await orderDetails(db)
    .where('o.status', '=', 'booked')
    .where('s.starts_at', '>', sql<Date>`now()`)
    .orderBy('s.starts_at')
    .orderBy('o.id')
    .limit(JOB_LIST_LIMIT)
    .execute();
  return rows.map(toJobView);
}

/** The driver's claimed and delivered jobs, soonest slot first. */
export async function listMyJobs(db: Db, driverId: string): Promise<JobView[]> {
  const rows = await orderDetails(db)
    .where('o.driver_id', '=', driverId)
    .orderBy('s.starts_at')
    .orderBy('o.id')
    .limit(JOB_LIST_LIMIT)
    .execute();
  return rows.map(toJobView);
}
