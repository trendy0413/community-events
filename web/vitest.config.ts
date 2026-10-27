import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// The web tests cover logic only (the proof page's counting and checks), so
// they run in Node with no browser.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  }),
);
