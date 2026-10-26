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
});

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  logLevel: (typeof LOG_LEVELS)[number];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Fail at startup, not on the first request that needs the value.
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const { PORT, HOST, DATABASE_URL, LOG_LEVEL } = parsed.data;
  return { port: PORT, host: HOST, databaseUrl: DATABASE_URL, logLevel: LOG_LEVEL };
}
