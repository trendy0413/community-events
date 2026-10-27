// O3: the count alert. Lists every event and delivery slot whose stored count
// differs from its rows, and exits 1 if there is any, which fails the
// scheduled monitor workflow, and that failure is the alert. Read-only.
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { findCountDrift } from '../src/db/count-drift.js';

const db = createDb(loadConfig().databaseUrl);
try {
  const { events, slots } = await findCountDrift(db);
  // Titles are user input and may hold line breaks; quoted as JSON they stay
  // on one line, so they cannot forge lines or CI log commands.
  for (const drift of events) {
    const title = JSON.stringify(drift.title);
    console.log(`FAIL event ${drift.id} ${title}: registered_count ${drift.stored}, active registrations ${drift.rows}`);
  }
  for (const drift of slots) {
    const title = JSON.stringify(drift.title);
    console.log(`FAIL slot ${drift.id} ${title}: booked_count ${drift.stored}, orders not cancelled ${drift.rows}`);
  }
  if (events.length + slots.length > 0) {
    console.error(`\n${events.length} event(s) and ${slots.length} slot(s) have a count that differs from their rows.`);
    process.exitCode = 1;
  } else {
    console.log('ok   every event and slot count equals its rows');
  }
} finally {
  await db.destroy();
}
