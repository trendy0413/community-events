import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../auth/devAuth.js';
import { authorize } from '../../auth/policy.js';
import type { Db } from '../../db/client.js';
import { EventIdParams, problems } from '../../http/schemas.js';
import { listMyRegistrations } from './repository.js';
import {
  MyRegistrationsQuery,
  MyRegistrationsResponse,
  RegistrationResponse,
  toMyRegistrationsResponse,
  toRegistrationResponse,
} from './schemas.js';
import { cancel, register } from './service.js';

// "me" instead of a registration id: the server knows who is calling, so a
// client needs no id, and nobody can name another person's registration.
// PUT and DELETE are idempotent, so a mobile client can retry on a weak network.
export const registrationRoutes: FastifyPluginCallbackZod<{ db: Db }> = (app, { db }, done) => {
  app.put(
    '/events/:id/registrations/me',
    {
      schema: {
        operationId: 'registerForEvent',
        tags: ['registrations'],
        summary: 'Register for an event (201 new, 200 already registered)',
        params: EventIdParams,
        response: { 200: RegistrationResponse, 201: RegistrationResponse, ...problems(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      authorize(actor, 'registration:self');
      const { registration, created } = await register(db, request.params.id, actor.id);
      return reply.status(created ? 201 : 200).send(toRegistrationResponse(registration));
    },
  );

  app.delete(
    '/events/:id/registrations/me',
    {
      schema: {
        operationId: 'cancelRegistration',
        tags: ['registrations'],
        summary: 'Cancel your registration (204, also when there was none)',
        params: EventIdParams,
        response: { 204: z.null().describe('Cancelled, or nothing to cancel'), ...problems(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      authorize(actor, 'registration:self');
      await cancel(db, request.params.id, actor.id);
      return reply.status(204).send(null);
    },
  );

  app.get(
    '/me/registrations',
    {
      schema: {
        operationId: 'listMyRegistrations',
        tags: ['registrations'],
        summary: 'Your registrations, active and cancelled, newest first (attendees)',
        querystring: MyRegistrationsQuery,
        response: { 200: MyRegistrationsResponse, ...problems(400, 401, 403) },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      authorize(actor, 'registration:list-own');
      return toMyRegistrationsResponse(await listMyRegistrations(db, actor.id, request.query.limit));
    },
  );
  done();
};
