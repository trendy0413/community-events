import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { loadConfig } from '../../src/config.js';
import { migrate } from '../../src/db/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const MIN_SERVER_VERSION = 160000;
const MAX_IDENTIFIER_BYTES = 63;
const DUPLICATE_DATABASE = '42P04';

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
function explain(error: unknown): string {
  if (error instanceof AggregateError) return error.errors.map(explain).join('; ');
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

async function withClient<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  // Generous: a remote database through a VPN or proxy can take several
  // seconds to accept a connection; a missing one still fails in seconds.
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 20_000 });
  try {
    await client.connect();
  } catch (error) {
    // The URL is not printed: it can hold a password.
    stop(`Could not connect: ${explain(error)}`);
  }
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function sameDatabase(a: string, b: string): boolean {
  const [x, y] = [new URL(a), new URL(b)];
  return x.hostname === y.hostname && (x.port || '5432') === (y.port || '5432') && x.pathname === y.pathname;
}

/**
 * Tests empty their database at the start, so they must never run on the dev
 * database. By default they use "<dev database name>_test" on the same server,
 * created here if missing. TEST_DATABASE_URL overrides this.
 */
async function testDatabaseUrl(devUrl: string): Promise<string> {
  const override = process.env.TEST_DATABASE_URL;
  if (override) {
    if (sameDatabase(override, devUrl)) stop('TEST_DATABASE_URL points at the DATABASE_URL database. Tests would empty it.');
    return override;
  }

  const url = new URL(devUrl);
  const devName = decodeURIComponent(url.pathname.slice(1)) || 'postgres';
  // Always a new name, even for a dev database already called "*_test".
  const testName = `${devName}_test`;
  if (!/^[a-z0-9_]+$/.test(testName) || testName.length > MAX_IDENTIFIER_BYTES) {
    stop(`Cannot derive a safe test database name from "${devName}". Set TEST_DATABASE_URL.`);
  }

  await withClient(devUrl, async (client) => {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [testName]);
    if (exists.rowCount !== 0) return;
    try {
      // The name is checked above; identifiers cannot be bound as parameters.
      await client.query(`CREATE DATABASE "${testName}"`);
    } catch (error) {
      // Another test run created it at the same moment: that is fine.
      if ((error as { code?: string }).code === DUPLICATE_DATABASE) return;
      stop(`Could not create the test database "${testName}": ${explain(error)}. Create it, or set TEST_DATABASE_URL.`);
    }
  });

  url.pathname = `/${testName}`;
  return url.toString();
}

export default async function setup(project: TestProject): Promise<void> {
  const url = await testDatabaseUrl(loadConfig().databaseUrl);

  await withClient(url, async (client) => {
    const { rows } = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    const version = Number(rows[0]?.server_version_num);
    if (!(version >= MIN_SERVER_VERSION)) stop(`Found server_version_num ${String(version)}.`);
  });

  await migrate(url);
  // Start every run from empty tables. TRUNCATE does not fire the
  // no-delete trigger on registrations.
  await withClient(url, (client) => client.query('TRUNCATE orders, delivery_slots, registrations, events, users'));
  project.provide('databaseUrl', url);
}
