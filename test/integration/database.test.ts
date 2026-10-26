import pg from 'pg';
import { expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

it('runs against PostgreSQL 16 or newer', async () => {
  const client = new pg.Client({ connectionString: loadConfig().databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ server_version_num: string }>('SHOW server_version_num');
    expect(Number(rows[0]?.server_version_num)).toBeGreaterThanOrEqual(160000);
  } finally {
    await client.end();
  }
});
