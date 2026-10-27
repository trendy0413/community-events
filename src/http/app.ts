import { randomUUID } from 'node:crypto';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AuthMode, Config } from '../config.js';
import type { Db } from '../db/client.js';
import { healthRoutes } from '../modules/health/routes.js';
import { frameworkErrors, registerErrorHandling } from './errors.js';
import { transformObject } from './openapi.js';
import { v1Routes } from './v1.js';

export interface AppOptions {
  db: Db;
  /** Must be given on purpose; there is no default (R9). */
  authMode: AuthMode;
  logLevel?: Config['logLevel'];
}

// The type already limits authMode; this also stops an entry file that
// skipped loadServerConfig and passed an unchecked value.
function assertDevStub(mode: string): asserts mode is AuthMode {
  if (mode !== 'dev-stub') throw new Error(`Unsupported AUTH_MODE "${mode}"`);
}

export async function buildApp(options: AppOptions) {
  assertDevStub(options.authMode);

  const app = Fastify({
    logger: {
      level: options.logLevel ?? 'info',
      redact: ['req.headers.authorization', 'req.headers["x-dev-user-id"]'],
    },
    genReqId: () => randomUUID(),
    frameworkErrors,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('actor', null);
  registerErrorHandling(app);

  // Some HTTP clients, several mobile ones among them, send
  // "Content-Type: application/json" on a PUT or DELETE with no body. Register
  // and cancel take no body, so an empty one counts as none; a route that
  // needs a body still rejects it through its schema.
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (body === '') {
      done(null, undefined);
      return;
    }
    // Calls done; its result type also allows a promise, which it does not return here.
    void parseJson(request, body.toString(), done);
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    // Seat counts change every second during a rush; a cached copy would
    // show a free seat that is already gone (SPEC section 6).
    if (request.url.startsWith('/v1')) reply.header('cache-control', 'no-store');
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Community Events API',
        version: '0.1.0',
        description: 'Contract for docs/SPEC.md. Identity is a dev stub: send a demo user id in X-Dev-User-Id.',
      },
      components: {
        securitySchemes: {
          devUser: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Dev-User-Id',
            description: 'Dev identity stub (SPEC section 9): the id of a seeded demo user. Not real sign-in.',
          },
        },
      },
      security: [{ devUser: [] }],
      tags: [
        { name: 'events', description: 'Events, their seat counts and their capacity' },
        { name: 'registrations', description: 'Register and cancel. Both are safe to retry.' },
        { name: 'users', description: 'The signed-in user, and every user for admins' },
        { name: 'health', description: 'Is the API up, and can it reach the database? No identity needed.' },
      ],
    },
    transform: jsonSchemaTransform,
    transformObject,
  });
  // Security headers on every response. The API serves JSON only, so its
  // content policy allows nothing. Swagger UI sets a policy of its own that
  // lets its scripts run; its renderer also sets inline styles, which are
  // allowed there (styles cannot run code).
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
    transformStaticCSP: (header) => header.replace("style-src 'self' https:", "style-src 'self' https: 'unsafe-inline'"),
  });
  // The contract at a stable path, for client generators (SPEC section 6).
  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());

  await app.register(healthRoutes, { prefix: '/v1', db: options.db, authMode: options.authMode });
  await app.register(v1Routes, { prefix: '/v1', db: options.db });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
