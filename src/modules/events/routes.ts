import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { actorOf } from '../../auth/devAuth.js';
import { authorize } from '../../auth/policy.js';
import type { Db } from '../../db/client.js';
import { DomainError } from '../../http/errors.js';
import { EventIdParams, problems } from '../../http/schemas.js';
import { findEventOwner, findEventView, insertEvent, listActiveRegistrations, listEventViews } from './repository.js';
import {
  AttendeeListResponse,
  ChangeCapacityBody,
  CreateEventBody,
  EventListResponse,
  EventResponse,
  ListEventsQuery,
} from './schemas.js';
import { changeCapacity } from './service.js';

const notFound = () => new DomainError('NOT_FOUND', 'This event does not exist.');

export const eventRoutes: FastifyPluginCallbackZod<{ db: Db }> = (app, { db }, done) => {
  app.get(
    '/events',
    {
      schema: {
        operationId: 'listEvents',
        tags: ['events'],
        summary: 'List events that have not started, soonest first (scope=past: admins, started events, newest first)',
        querystring: ListEventsQuery,
        response: { 200: EventListResponse, ...problems(400, 401, 403) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      const { organizer, scope, limit } = request.query;
      authorize(actor, scope === 'past' ? 'event:list-past' : 'event:read');
      const events = await listEventViews(db, actor.id, {
        ...(organizer === 'me' ? { organizerId: actor.id } : {}),
        past: scope === 'past',
        limit,
      });
      return { events };
    },
  );

  app.post(
    '/events',
    {
      schema: {
        operationId: 'createEvent',
        tags: ['events'],
        summary: 'Create an event (organizers). The Location header gives its URL.',
        body: CreateEventBody,
        response: { 201: EventResponse, ...problems(400, 401, 403) },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      authorize(actor, 'event:create');
      const id = await insertEvent(db, actor.id, request.body);
      const event = await findEventView(db, id, actor.id);
      if (!event) throw notFound();
      return reply.status(201).header('location', `/v1/events/${id}`).send(event);
    },
  );

  app.get(
    '/events/:id',
    {
      schema: {
        operationId: 'getEvent',
        tags: ['events'],
        summary: 'Get one event, also a past one, with seats left and your own registration',
        params: EventIdParams,
        response: { 200: EventResponse, ...problems(400, 401, 404) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      authorize(actor, 'event:read');
      const event = await findEventView(db, request.params.id, actor.id);
      if (!event) throw notFound();
      return event;
    },
  );

  app.patch(
    '/events/:id',
    {
      schema: {
        operationId: 'changeEventCapacity',
        tags: ['events'],
        summary: "Change an event's capacity (its organizer; not below the people registered)",
        params: EventIdParams,
        body: ChangeCapacityBody,
        response: { 200: EventResponse, ...problems(400, 401, 403, 404, 409) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      const owner = await findEventOwner(db, request.params.id);
      if (!owner) throw notFound();
      authorize(actor, 'event:update', owner);
      await changeCapacity(db, request.params.id, actor.id, request.body.capacity);
      const event = await findEventView(db, request.params.id, actor.id);
      if (!event) throw notFound();
      return event;
    },
  );

  app.get(
    '/events/:id/registrations',
    {
      schema: {
        operationId: 'listEventRegistrations',
        tags: ['events'],
        summary: "List who registered (the event's organizer and admins)",
        params: EventIdParams,
        response: { 200: AttendeeListResponse, ...problems(400, 401, 403, 404) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      const owner = await findEventOwner(db, request.params.id);
      if (!owner) throw notFound();
      authorize(actor, 'event:list-registrations', owner);
      return listActiveRegistrations(db, request.params.id);
    },
  );
  done();
};
