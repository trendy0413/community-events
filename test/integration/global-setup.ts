import pg from 'pg';
import { loadConfig } from '../../src/config.js';

const MIN_SERVER_VERSION = 160000;

const HOW_TO_FIX =
  'This run needs PostgreSQL 16 for the integration tests. Set DATABASE_URL (see .env.example) or run `npm run db:up`.';

// Stop within seconds with one clear message, instead of every test failing
// with a connection error. A missing database must never look like a pass.
// The message is printed and the run exits, because an error thrown from a
// global setup can be lost when the test runner formats its stack.
function stop(reason: string): never {
  console.error(`\n${HOW_TO_FIX}\n${reason}\n`);
  process.exit(1);
}

// Node wraps a failed connect to several addresses (IPv4 and IPv6) in an
// AggregateError; the inner errors hold the useful part, like ECONNREFUSED.
function describe(error: unknown): string {
  if (error instanceof AggregateError) return error.errors.map(describe).join('; ');
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export default async function setup(): Promise<void> {
  const client = new pg.Client({
    connectionString: loadConfig().databaseUrl,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
  } catch (error) {
    // The URL is not printed: it can hold a password.
    stop(`Could not connect: ${describe(error)}`);
  }

  try {
    const { rows } = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    const version = Number(rows[0]?.server_version_num);
    if (!(version >= MIN_SERVER_VERSION)) stop(`Found server_version_num ${String(version)}.`);
  } finally {
    await client.end();
  }
}
