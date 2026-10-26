import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { seed } from '../src/db/seed.js';

const db = createDb(loadConfig().databaseUrl);
try {
  const { people, events } = await seed(db);
  console.log(`Seeded ${people} people and ${events} events.`);
} finally {
  await db.destroy();
}
