// The server entry. On the demo host (Vercel) this file becomes the one
// function. Vercel takes the first of src/app.*, src/index.* and
// src/server.* that exists, and only if that file imports 'fastify'. So no
// other file in src/ may take one of those names, and the import below must
// stay in this file.
import type { FastifyListenOptions } from 'fastify';
import { loadServerConfig } from './config.js';
import { createDb } from './db/client.js';
import { buildApp } from './http/app.js';

// Throws before anything starts when AUTH_MODE is missing (R9).
const config = loadServerConfig();
const db = createDb(config.databaseUrl);
const app = await buildApp({ db, authMode: config.authMode, logLevel: config.logLevel });
app.addHook('onClose', () => db.destroy());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    // Finish in-flight requests before exiting, so no transaction is cut off.
    void app.close().then(() => process.exit(0));
  });
}

// Not awaited: on the demo host, listen() hands the server to the platform
// and may never resolve, and module loading must still finish.
const listenOptions: FastifyListenOptions = { port: config.port, host: config.host };
app.listen(listenOptions).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
