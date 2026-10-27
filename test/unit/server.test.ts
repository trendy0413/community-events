import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../../src/config.js';

const repoRoot = path.resolve(import.meta.dirname, '../..');

/** Starts the real server entry file with the given AUTH_MODE (or none). */
function startServer(authMode: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: '0', LOG_LEVEL: 'silent' };
  delete env.AUTH_MODE;
  if (authMode !== undefined) env.AUTH_MODE = authMode;
  // If the server did start, it would keep running; the timeout ends it and
  // the test fails on the exit status.
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

describe('server startup', () => {
  it('R9 server refuses to start without AUTH_MODE', () => {
    for (const authMode of [undefined, '', 'jwt']) {
      const result = startServer(authMode);
      expect(result.status, `AUTH_MODE=${String(authMode)}`).toBe(1);
      expect(result.stderr).toContain('AUTH_MODE must be set to "dev-stub"');
    }
  }, 60_000);

  it('accepts AUTH_MODE=dev-stub', () => {
    expect(loadServerConfig({ AUTH_MODE: 'dev-stub' }).authMode).toBe('dev-stub');
  });

  it('keeps src/server.ts as the entry file the demo host picks', () => {
    // Vercel runs the first of these that exists (see src/server.ts).
    const candidates = ['src/app', 'src/index', 'src/server', 'app', 'index', 'server'].flatMap((name) =>
      ['js', 'mjs', 'cjs', 'ts', 'cts', 'mts'].map((extension) => `${name}.${extension}`),
    );

    expect(candidates.find((file) => existsSync(path.join(repoRoot, file)))).toBe('src/server.ts');
  });
});
