import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

export type Db = Kysely<Database>;

export interface DbOptions {
  /** Pool size. Concurrency tests need more connections than parallel calls. */
  max?: number;
  /** Called when an idle pooled connection fails. Defaults to stderr. */
  onIdleError?: (error: Error) => void;
}

export function createDb(databaseUrl: string, options: DbOptions = {}): Db {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    // Short idle time: serverless hosts suspend idle instances, and a pooled
    // connection left open there is never closed cleanly.
    idleTimeoutMillis: 5000,
  });
  // Without a listener, a server closing an idle connection (a database that
  // scales to zero does this) crashes the process. The pool drops the broken
  // connection and opens a new one on the next query.
  pool.on(
    'error',
    options.onIdleError ??
      ((error) => {
        console.error(`database: idle connection failed: ${error.message}`);
      }),
  );
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
