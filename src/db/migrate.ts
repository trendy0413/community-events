import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../migrations');
// Any fixed number works; it only has to be the same for every runner.
const MIGRATION_LOCK_KEY = 4_247_001;

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies migrations/*.sql in name order, each at most once. All pending files
 * run in one transaction under a transaction-level advisory lock, so two
 * runners at the same time (for example two deploys) can neither apply a file
 * twice nor leave half a schema.
 *
 * Because of that one transaction, a migration file must not contain its own
 * BEGIN/COMMIT, or statements that cannot run in a transaction block, such as
 * CREATE INDEX CONCURRENTLY.
 */
export async function migrate(databaseUrl: string): Promise<MigrateResult> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((row) => row.name));

    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      // Sent without parameters, so pg uses the simple protocol, which allows
      // several statements and $$ function bodies in one call.
      await client.query(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      applied.push(file);
    }
    await client.query('COMMIT');
    return { applied, skipped: files.filter((file) => done.has(file)) };
  } catch (error) {
    // If the connection itself broke, ROLLBACK fails too; keep the first error.
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
