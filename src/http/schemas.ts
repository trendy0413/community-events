import { z } from 'zod';

// Shared request and response schemas. Zod validates every input, and each
// /v1 route also declares its responses: the server sends only the fields
// listed there, so a new database column never leaks (SPEC section 6).
// `.meta({ id })` names a schema in the OpenAPI contract (src/http/openapi.ts).

export const ProblemSchema = z
  .object({
    type: z.literal('about:blank'),
    title: z.string(),
    status: z.number().int(),
    code: z.enum([
      'VALIDATION_FAILED',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'EVENT_FULL',
      'EVENT_STARTED',
      'CAPACITY_BELOW_REGISTERED',
      'SLOT_FULL',
      'SLOT_STARTED',
      'ORDER_ID_IN_USE',
      'ORDER_CLAIMED',
      'JOB_TAKEN',
      'JOB_NOT_OPEN',
      'INTERNAL_ERROR',
    ]),
    detail: z.string(),
    errors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'Problem', description: 'Error in the problem+json shape (SPEC section 7)' });

const PROBLEM_RESPONSE = {
  description: 'Error (SPEC section 7). Clients switch on `code`.',
  content: { 'application/problem+json': { schema: ProblemSchema } },
};

type ErrorStatus = 400 | 401 | 403 | 404 | 409;

/**
 * Error responses a route can return, plus 500, which any route can. They
 * are declared with the content type the server really sends, so generated
 * clients read error bodies as problem+json.
 */
export function problems<S extends ErrorStatus>(...statuses: S[]): Record<S | 500, typeof PROBLEM_RESPONSE> {
  return Object.fromEntries([...statuses, 500].map((status) => [status, PROBLEM_RESPONSE])) as Record<
    S | 500,
    typeof PROBLEM_RESPONSE
  >;
}

export const EventIdParams = z.object({ id: z.uuid() });

// Lists have no pages beyond this (SPEC section 12), so every list is capped.
export const LimitQuery = z.coerce.number().int().min(1).max(50).default(20);

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Intl does not list UTC itself, though it accepts it.
const KNOWN_ZONES = new Map([...Intl.supportedValuesOf('timeZone'), 'UTC'].map((zone) => [zone.toLowerCase(), zone]));

/**
 * The IANA name for a time zone with its standard spelling, or null. Clients
 * such as Android's ZoneId are case-sensitive, so "america/new_york" is stored
 * as "America/New_York". Intl's own canonical name is not used: Node's time
 * zone data maps current names to old ones (Europe/Kyiv to Europe/Kiev), so a
 * name Intl accepts but does not list is kept as sent. Offset ids like
 * "+05:30" are not IANA names.
 */
function canonicalTimeZone(name: string): string | null {
  if (!/^[A-Za-z]/.test(name)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
  } catch {
    return null;
  }
  return KNOWN_ZONES.get(name.toLowerCase()) ?? name;
}

// PostgreSQL text cannot hold a NUL character; without this check such a
// title would fail in the database (500) instead of here (400).
export const NO_NUL = [(value: string) => !value.includes('\0'), 'Must not contain a NUL character'] as const;

/**
 * A start time: RFC 3339 with an offset (or Z), because a time without one
 * means a different moment in every time zone; in the future and less than
 * a year away. A value that is not a date stops at the format check, so it
 * does not also get "must be in the future". Stored as UTC: RFC 3339 allows
 * offsets up to ±23:59 and PostgreSQL only up to ±15:59.
 */
export const FutureStart = z.iso
  .datetime({ offset: true, abort: true })
  .refine((value) => Date.parse(value) > Date.now(), 'Must be in the future')
  .refine((value) => Date.parse(value) < Date.now() + YEAR_MS, 'Must be less than 1 year away')
  .transform((value) => new Date(value).toISOString());

export const TimeZoneName = z.string().transform((value, ctx) => {
  const canonical = canonicalTimeZone(value);
  if (canonical) return canonical;
  ctx.addIssue({ code: 'custom', message: 'Must be an IANA time zone, for example America/New_York' });
  return z.NEVER;
});
