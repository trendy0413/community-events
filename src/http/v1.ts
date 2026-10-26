import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { registerDevIdentity } from '../auth/devAuth.js';
import type { Db } from '../db/client.js';
import { eventRoutes } from '../modules/events/routes.js';
import { registrationRoutes } from '../modules/registrations/routes.js';

/**
 * Everything under /v1. The identity check is added in this plugin scope, so
 * it runs before every route registered here (R8). Routes that need no
 * identity, such as /v1/health, are registered outside this scope.
 */
export const v1Routes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  registerDevIdentity(app, db);
  await app.register(eventRoutes, { db });
  await app.register(registrationRoutes, { db });
};
