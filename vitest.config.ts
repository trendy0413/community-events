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
        },
      },
    ],
  },
});
