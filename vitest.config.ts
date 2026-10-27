import { defineConfig } from 'vitest/config';

// Local runs take DATABASE_URL from .env when it exists. CI sets it directly.
try {
  process.loadEnvFile();
} catch {
  // No .env file: use the environment as it is.
}

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          // The database can be a remote host (for example a cloud branch).
          // Measured on one: ~270 ms per round trip and 1.7-3.4 s per new
          // connection, so a race test that opens 50 connections can take
          // tens of seconds. A real lock bug still fails: PostgreSQL detects
          // deadlocks within a second, and a stuck wait hits this limit.
          testTimeout: 120_000,
          hookTimeout: 120_000,
          // One file at a time: the race tests load the database on purpose,
          // and on a small server that load slowed other files' tests into
          // their timeouts. Tests inside a file still run their own races.
          fileParallelism: false,
        },
      },
    ],
  },
});
