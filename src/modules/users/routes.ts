import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../auth/devAuth.js';
import { authorize } from '../../auth/policy.js';
import type { Db } from '../../db/client.js';
import { ROLES } from '../../db/schema.js';
import { problems } from '../../http/schemas.js';
import { listUsers } from './repository.js';

const UserResponse = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  roles: z.array(z.enum(ROLES)),
});

export const userRoutes: FastifyPluginCallbackZod<{ db: Db }> = (app, { db }, done) => {
  app.get(
    '/me',
    {
      schema: {
        operationId: 'getMe',
        tags: ['users'],
        summary: 'The signed-in user, with their roles',
        response: { 200: UserResponse, ...problems(401) },
      },
    },
    (request) => {
      const actor = actorOf(request);
      authorize(actor, 'me:read');
      return actor;
    },
  );

  app.get(
    '/users',
    {
      schema: {
        operationId: 'listUsers',
        tags: ['users'],
        summary: 'All users, with emails (admins)',
        response: { 200: z.object({ users: z.array(UserResponse) }), ...problems(401, 403) },
      },
    },
    async (request) => {
      authorize(actorOf(request), 'user:list');
      return { users: await listUsers(db) };
    },
  );
  done();
};
