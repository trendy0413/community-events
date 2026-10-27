import { z } from 'zod';
import { FutureStart, LimitQuery, NO_NUL, TimeZoneName } from '../../http/schemas.js';

// The jobsite supply flow (SPEC section 14).

export const SlotIdParams = z.object({ id: z.uuid() });
export const OrderIdParams = z.object({ orderId: z.uuid() });
// The client chooses the order id, so a retried request names the same order (S2).
export const SlotOrderParams = z.object({ id: z.uuid(), orderId: z.uuid() });

// S8. strictObject rejects unknown fields, as for events (R10).
export const CreateSlotBody = z
  .strictObject({
    title: z.string().trim().min(3).max(80).refine(...NO_NUL),
    area: z.string().trim().min(2).max(80).refine(...NO_NUL),
    startsAt: FutureStart,
    timezone: TimeZoneName,
    capacity: z.number().int().min(1).max(50),
  })
  .meta({ id: 'CreateSlot' });

export type CreateSlotInput = z.infer<typeof CreateSlotBody>;

export const PlaceOrderBody = z
  .strictObject({
    items: z.string().trim().min(3).max(500).refine(...NO_NUL),
    jobsite: z.string().trim().min(3).max(200).refine(...NO_NUL),
  })
  .meta({ id: 'PlaceOrder' });

export type PlaceOrderInput = z.infer<typeof PlaceOrderBody>;

export const ListSlotsQuery = z.strictObject({
  supplier: z.literal('me').optional(),
  limit: LimitQuery,
});

export const MyOrdersQuery = z.strictObject({ limit: LimitQuery });

// Ids and names only: other people's emails never leave the server (S7).
const Person = z.object({ id: z.uuid(), name: z.string() });

export const SlotResponse = z
  .object({
    id: z.uuid(),
    title: z.string(),
    area: z.string(),
    startsAt: z.iso.datetime(),
    timezone: z.string(),
    capacity: z.number().int(),
    bookedCount: z.number().int(),
    deliveriesLeft: z.number().int(),
    supplier: Person,
  })
  .meta({ id: 'Slot' });

export type SlotView = z.infer<typeof SlotResponse>;

export const SlotListResponse = z.object({ slots: z.array(SlotResponse) }).meta({ id: 'SlotList' });

const OrderStatus = z.enum(['booked', 'claimed', 'delivered', 'cancelled']);

const SlotSummary = z.object({
  id: z.uuid(),
  title: z.string(),
  area: z.string(),
  startsAt: z.iso.datetime(),
  timezone: z.string(),
  supplier: Person,
});

/** A contractor's own order. */
export const OrderResponse = z
  .object({
    id: z.uuid(),
    slot: SlotSummary,
    items: z.string(),
    jobsite: z.string(),
    status: OrderStatus,
    driver: Person.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Order' });

export type OrderView = z.infer<typeof OrderResponse>;

export const MyOrdersResponse = z.object({ orders: z.array(OrderResponse) }).meta({ id: 'MyOrders' });

/** A slot's orders, for its supplier and admins: the contractor's name, never their email (S7). */
export const SlotOrdersResponse = z
  .object({
    orders: z.array(
      z.object({
        id: z.uuid(),
        contractor: Person,
        items: z.string(),
        jobsite: z.string(),
        status: OrderStatus,
        driver: Person.nullable(),
        createdAt: z.iso.datetime(),
      }),
    ),
  })
  .meta({ id: 'SlotOrders' });

export type SlotOrders = z.infer<typeof SlotOrdersResponse>;

/** An order as a delivery job, for drivers: no contractor at all (S7). */
export const JobResponse = z
  .object({
    id: z.uuid(),
    slot: SlotSummary,
    items: z.string(),
    jobsite: z.string(),
    status: OrderStatus,
    driver: Person.nullable(),
  })
  .meta({ id: 'Job' });

export type JobView = z.infer<typeof JobResponse>;

export const JobBoardResponse = z
  .object({ open: z.array(JobResponse), mine: z.array(JobResponse) })
  .meta({ id: 'JobBoard' });
