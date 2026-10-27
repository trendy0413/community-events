import { z } from 'zod';

// Matches docker-compose.yml. Local development only; these values are not secrets.
export const LOCAL_DATABASE_URL =
  'postgres://community_events:community_events@localhost:15432/community_events';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Loopback by default: with the dev identity stub, anyone who can reach the
  // port can act as any user. Hosts that need it set HOST=0.0.0.0.
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z.url().default(LOCAL_DATABASE_URL),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  // Optional error tracking (O2). An empty value, as an unset variable in a
  // compose file gives, means off.
  SENTRY_DSN: z.preprocess((value) => (value === '' ? undefined : value), z.url().optional()),
  SENTRY_ENVIRONMENT: z.string().min(1).optional(),
  // Set by the demo host on each deploy; tags errors with the commit.
  VERCEL_GIT_COMMIT_SHA: z.string().min(1).optional(),
});

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  logLevel: (typeof LOG_LEVELS)[number];
  sentry?: { dsn: string; environment: string; release?: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Fail at startup, not on the first request that needs the value.
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const { PORT, HOST, DATABASE_URL, LOG_LEVEL, SENTRY_DSN, SENTRY_ENVIRONMENT, VERCEL_GIT_COMMIT_SHA } = parsed.data;
  return {
    port: PORT,
    host: HOST,
    databaseUrl: DATABASE_URL,
    logLevel: LOG_LEVEL,
    ...(SENTRY_DSN
      ? {
          sentry: {
            dsn: SENTRY_DSN,
            environment: SENTRY_ENVIRONMENT ?? 'development',
            ...(VERCEL_GIT_COMMIT_SHA ? { release: VERCEL_GIT_COMMIT_SHA } : {}),
          },
        }
      : {}),
  };
}

/** The only identity mode this build has: the dev stub (SPEC section 9). */
export type AuthMode = 'dev-stub';

export interface ServerConfig extends Config {
  authMode: AuthMode;
}

// R9: no default. Real sign-in does not exist yet, so the server must be
// told on purpose that it runs the stub; a deploy that forgets the variable
// stops at startup instead of trusting a header in silence.
const AuthModeSchema = z.literal('dev-stub', {
  error: 'AUTH_MODE must be set to "dev-stub". It is the only identity mode in this build (see docs/SPEC.md section 9).',
});

/** Config for the HTTP server. Scripts that only touch the database use loadConfig. */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const authMode = AuthModeSchema.safeParse(env.AUTH_MODE);
  if (!authMode.success) throw new Error(`Invalid environment:\n${z.prettifyError(authMode.error)}`);
  return { ...loadConfig(env), authMode: authMode.data };
}
