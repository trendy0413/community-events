import { randomUUID } from 'node:crypto';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { frameworkErrors, registerErrorHandling } from './http/errors.js';

export interface AppOptions {
  logLevel?: Config['logLevel'];
}

export async function buildApp(options: AppOptions = {}) {
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
  registerErrorHandling(app);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    // Seat counts change every second during a rush; a cached copy would
    // show a free seat that is already gone (SPEC section 6).
    if (request.url.startsWith('/v1')) reply.header('cache-control', 'no-store');
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Community Events API', version: '0.1.0' },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
