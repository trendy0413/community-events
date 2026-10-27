import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../auth/devAuth.js';
import { authorize } from '../../auth/policy.js';
import type { Db } from '../../db/client.js';
import { DomainError } from '../../http/errors.js';
import { problems } from '../../http/schemas.js';
import {
  findJobView,
  findOrderView,
  findSlotOwner,
  findSlotView,
  insertSlot,
  listMyJobs,
  listMyOrders,
  listOpenJobs,
  listSlotOrders,
  listSlotViews,
} from './repository.js';
import {
  CreateSlotBody,
  JobBoardResponse,
  JobResponse,
  ListSlotsQuery,
  MyOrdersQuery,
  MyOrdersResponse,
  OrderIdParams,
  OrderResponse,
  PlaceOrderBody,
  SlotIdParams,
  SlotListResponse,
  SlotOrderParams,
  SlotOrdersResponse,
  SlotResponse,
} from './schemas.js';
import { cancelOrder, claim, markDelivered, placeOrder } from './service.js';

// The jobsite supply flow (SPEC section 14). Writes are PUT and DELETE on
// ids the client knows, so a phone on a jobsite can retry them safely.

const slotNotFound = () => new DomainError('NOT_FOUND', 'This delivery slot does not exist.');
const orderNotFound = () => new DomainError('NOT_FOUND', 'This order does not exist.');

export const supplyRoutes: FastifyPluginCallbackZod<{ db: Db }> = (app, { db }, done) => {
  app.get(
    '/slots',
    {
      schema: {
        operationId: 'listSlots',
        tags: ['supply'],
        summary: 'List delivery slots that have not started, soonest first (supplier=me: your own)',
        querystring: ListSlotsQuery,
        response: { 200: SlotListResponse, ...problems(400, 401, 403) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      authorize(actor, 'slot:read');
      const { supplier, limit } = request.query;
      return { slots: await listSlotViews(db, { ...(supplier === 'me' ? { supplierId: actor.id } : {}), limit }) };
    },
  );

  app.post(
    '/slots',
    {
      schema: {
        operationId: 'createSlot',
        tags: ['supply'],
        summary: 'Publish a delivery slot (suppliers). The Location header gives its URL.',
        body: CreateSlotBody,
        response: { 201: SlotResponse, ...problems(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      authorize(actor, 'slot:create');
      const id = await insertSlot(db, actor.id, request.body);
      const slot = await findSlotView(db, id);
      if (!slot) throw slotNotFound();
      return reply.status(201).header('location', `/v1/slots/${id}`).send(slot);
    },
  );

  app.get(
    '/slots/:id',
    {
      schema: {
        operationId: 'getSlot',
        tags: ['supply'],
        summary: 'Get one delivery slot, with the deliveries left',
        params: SlotIdParams,
        response: { 200: SlotResponse, ...problems(400, 401, 403, 404) },
      },
    },
    async (request) => {
      authorize(actorOf(request), 'slot:read');
      const slot = await findSlotView(db, request.params.id);
      if (!slot) throw slotNotFound();
      return slot;
    },
  );

  app.get(
    '/slots/:id/orders',
    {
      schema: {
        operationId: 'listSlotOrders',
        tags: ['supply'],
        summary: "List a slot's orders (its supplier and admins)",
        params: SlotIdParams,
        response: { 200: SlotOrdersResponse, ...problems(400, 401, 403, 404) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      const owner = await findSlotOwner(db, request.params.id);
      if (!owner) throw slotNotFound();
      authorize(actor, 'slot:list-orders', owner);
      return listSlotOrders(db, request.params.id);
    },
  );

  app.put(
    '/slots/:id/orders/:orderId',
    {
      schema: {
        operationId: 'placeOrder',
        tags: ['supply'],
        summary: 'Order a delivery in a slot under your own order id (201 new, 200 the same order again)',
        params: SlotOrderParams,
        body: PlaceOrderBody,
        response: { 200: OrderResponse, 201: OrderResponse, ...problems(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      authorize(actor, 'order:own');
      const { created } = await placeOrder(db, request.params.id, request.params.orderId, actor.id, request.body);
      const order = await findOrderView(db, request.params.orderId);
      if (!order) throw orderNotFound();
      return reply.status(created ? 201 : 200).send(order);
    },
  );

  app.delete(
    '/orders/:orderId',
    {
      schema: {
        operationId: 'cancelOrder',
        tags: ['supply'],
        summary: 'Cancel your order (204, also when already cancelled)',
        params: OrderIdParams,
        response: { 204: z.null().describe('Cancelled, or already cancelled'), ...problems(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      authorize(actor, 'order:own');
      await cancelOrder(db, request.params.orderId, actor.id);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/me/orders',
    {
      schema: {
        operationId: 'listMyOrders',
        tags: ['supply'],
        summary: 'Your orders, newest first (contractors)',
        querystring: MyOrdersQuery,
        response: { 200: MyOrdersResponse, ...problems(400, 401, 403) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      authorize(actor, 'order:own');
      return { orders: await listMyOrders(db, actor.id, request.query.limit) };
    },
  );

  app.get(
    '/jobs',
    {
      schema: {
        operationId: 'listJobs',
        tags: ['supply'],
        summary: 'Delivery jobs nobody has taken, and yours (drivers)',
        response: { 200: JobBoardResponse, ...problems(401, 403) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      authorize(actor, 'job:work');
      const [open, mine] = await Promise.all([listOpenJobs(db), listMyJobs(db, actor.id)]);
      return { open, mine };
    },
  );

  app.put(
    '/jobs/:orderId/driver',
    {
      schema: {
        operationId: 'claimJob',
        tags: ['supply'],
        summary: 'Take a delivery job (drivers). Exactly one driver gets it; taking it again is fine.',
        params: OrderIdParams,
        response: { 200: JobResponse, ...problems(400, 401, 403, 404, 409) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      authorize(actor, 'job:work');
      await claim(db, request.params.orderId, actor.id);
      const job = await findJobView(db, request.params.orderId);
      if (!job) throw orderNotFound();
      return job;
    },
  );

  app.put(
    '/jobs/:orderId/delivered',
    {
      schema: {
        operationId: 'markJobDelivered',
        tags: ['supply'],
        summary: 'Mark your delivery job delivered (the driver who took it)',
        params: OrderIdParams,
        response: { 200: JobResponse, ...problems(400, 401, 403, 404) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      authorize(actor, 'job:work');
      await markDelivered(db, request.params.orderId, actor.id);
      const job = await findJobView(db, request.params.orderId);
      if (!job) throw orderNotFound();
      return job;
    },
  );
  done();
};
