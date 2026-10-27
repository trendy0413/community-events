import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { seed } from '../src/db/seed.js';

const db = createDb(loadConfig().databaseUrl);
try {
  const { people, events, slots } = await seed(db);
  console.log(`Seeded ${people} people, ${events} events and ${slots} delivery slots.`);
} finally {
  await db.destroy();
}
