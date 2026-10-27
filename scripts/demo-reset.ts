// Wipes the demo database and seeds it again (SPEC W5). Applies migrations
// first, so it also sets up a new, empty database. It refuses to wipe a
// database that holds people outside seed/personas.json.
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { resetDemo } from '../src/db/seed.js';

// The direct connection when there is one, as for migrations.
const url = process.env.DATABASE_URL_UNPOOLED ?? loadConfig().databaseUrl;

await migrate(url);
const db = createDb(url);
try {
  const { people, events, registrations, slots, orders } = await resetDemo(db);
  console.log(`Demo reset: ${people} people, ${events} events, ${registrations} seats taken, ${slots} delivery slots, ${orders} orders.`);
} finally {
  await db.destroy();
}
