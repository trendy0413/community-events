import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { DomainError } from '../http/errors.js';
import type { Actor } from './policy.js';

// Dev identity stub (SPEC section 9). The client names a seeded user in a
// header and the server trusts it, so this is a stand-in for sign-in, not
// security. It runs only when AUTH_MODE=dev-stub (R9). Permissions are real:
// roles are read from the database on every request, never from the client.

export const IDENTITY_HEADER = 'x-dev-user-id';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

const UserId = z.uuid();

/** Adds the identity check to every route in this plugin scope (R8). */
export function registerDevIdentity(app: FastifyInstance, db: Db): void {
  app.addHook('onRequest', async (request) => {
    const header = request.headers[IDENTITY_HEADER];
    const userId = UserId.safeParse(header);
    if (!userId.success) {
      throw new DomainError('UNAUTHENTICATED', 'Send the X-Dev-User-Id header with the id of a demo user.');
    }

    const user = await db
      .selectFrom('users')
      .select(['id', 'name', 'email', 'roles'])
      .where('id', '=', userId.data)
      .executeTakeFirst();
    if (!user) throw new DomainError('UNAUTHENTICATED', 'No user has this id.');

    request.actor = user;
  });
}

/** The signed-in user. Every route behind registerDevIdentity has one. */
export function actorOf(request: FastifyRequest): Actor {
  if (!request.actor) throw new DomainError('UNAUTHENTICATED', 'Send the X-Dev-User-Id header with the id of a demo user.');
  return request.actor;
}
