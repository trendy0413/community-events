import { Kysely, PostgresDialect, type PostgresPool } from 'kysely';
import pg from 'pg';
import { isLostConnection } from './lost-connection.js';
import type { Database } from './schema.js';

export type Db = Kysely<Database>;

export interface DbOptions {
  /** Pool size. Concurrency tests need more connections than parallel calls. */
  max?: number;
  /** Called when an idle pooled connection fails. Defaults to stderr. */
  onIdleError?: (error: Error) => void;
}

const CONNECT_ATTEMPTS = 3;
const CONNECT_RETRY_DELAY_MS = 200;

/**
 * Opening a connection can fail on its own: a database that scales to zero
 * may drop the first one while it wakes, and a burst of new connections can
 * be cut by a proxy. Nothing has run on such a connection yet, so trying
 * again is always safe. Failures during a query are not retried here.
 */
function withConnectRetry(pool: pg.Pool): PostgresPool {
  return {
    // Kysely uses these for query cancellation, as on a plain pg.Pool.
    Client: pg.Client,
    options: pool.options,
    async connect() {
      for (let attempt = 1; ; attempt++) {
        try {
          return await pool.connect();
        } catch (error) {
          if (attempt >= CONNECT_ATTEMPTS || !isLostConnection(error)) throw error;
          await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS * attempt));
        }
      }
    },
    end: () => pool.end(),
  };
}

export function createDb(databaseUrl: string, options: DbOptions = {}): Db {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    // Short idle time: serverless hosts suspend idle instances, and a pooled
    // connection left open there is never closed cleanly.
    idleTimeoutMillis: 5000,
    // No connectionTimeoutMillis: pg-pool also applies it to requests queued
    // for a busy pool, and that timeout is not a lost connection, so a burst
    // (the 50-for-10 race) would answer 500 instead of waiting its turn. A
    // database that hangs is bounded by the host's request time limit, and
    // /v1/health has a limit of its own.
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
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool: withConnectRetry(pool) }) });
}
