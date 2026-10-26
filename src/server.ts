import { buildApp } from './app.js';
import { loadServerConfig } from './config.js';
import { createDb } from './db/client.js';

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

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
