import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AuthMode } from '../../config.js';
import type { Db } from '../../db/client.js';

const HealthResponse = z.object({
  status: z.enum(['ok', 'unavailable']),
  db: z.enum(['ok', 'down']),
  identity: z.literal('dev-stub'),
}).meta({ id: 'Health' });

// A health check must answer quickly even when the database hangs, so a
// monitor sees "down" instead of a timeout of its own.
const DB_CHECK_TIMEOUT_MS = 5000;

async function databaseAnswers(db: Db, log: FastifyBaseLogger): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      log.warn(`health: the database did not answer within ${String(DB_CHECK_TIMEOUT_MS)} ms`);
      resolve(false);
    }, DB_CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([sql`SELECT 1`.execute(db).then(() => true), timeout]);
  } catch (error) {
    // The answer stays a plain "down"; the cause goes to the log only.
    log.warn({ err: error }, 'health: the database check failed');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** /v1/health needs no identity (R8), so it is registered outside the identity scope. */
export const healthRoutes: FastifyPluginCallbackZod<{ db: Db; authMode: AuthMode }> = (app, { db, authMode }, done) => {
  app.get(
    '/health',
    {
      schema: {
        operationId: 'getHealth',
        tags: ['health'],
        summary: 'Is the API up, and can it reach the database? (no identity needed)',
        security: [],
        response: { 200: HealthResponse, 503: HealthResponse },
      },
    },
    async (request, reply) => {
      const up = await databaseAnswers(db, request.log);
      return reply
        .status(up ? 200 : 503)
        .send({ status: up ? 'ok' : 'unavailable', db: up ? 'ok' : 'down', identity: authMode });
    },
  );
  done();
};
