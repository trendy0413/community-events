import { loadConfig } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';

// Hosts with a connection pooler (Neon, for example) advise running schema
// changes on the direct connection, which they give as DATABASE_URL_UNPOOLED.
const url = process.env.DATABASE_URL_UNPOOLED ?? loadConfig().databaseUrl;

const { applied, skipped } = await migrate(url);
console.log(
  applied.length > 0
    ? `Applied ${applied.length} migration(s): ${applied.join(', ')}`
    : `Schema is up to date (${skipped.length} migration(s) already applied).`,
);
