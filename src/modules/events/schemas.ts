import { z } from 'zod';
import { LimitQuery } from '../../http/schemas.js';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The canonical IANA name for a time zone, or null. Intl ignores case, so
 * "america/new_york" becomes "America/New_York": clients such as Android's
 * ZoneId are case-sensitive. Offset ids like "+05:30" are not IANA names.
 */
function canonicalTimeZone(name: string): string | null {
  if (!/^[A-Za-z]/.test(name)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

// R10. strictObject rejects unknown fields, so a typo in a field name is an
// error instead of a silently ignored value.
export const CreateEventBody = z.strictObject({
  title: z.string().trim().min(3).max(80),
  // An empty description is stored as "no description" (null), the same as
  // leaving it out.
  description: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => value || null),
  // RFC 3339: an offset (or Z) is required, because a time without one means
  // a different moment in every time zone.
  startsAt: z.iso
    .datetime({ offset: true })
    .refine((value) => Date.parse(value) > Date.now(), 'Must be in the future')
    .refine((value) => Date.parse(value) < Date.now() + YEAR_MS, 'Must be less than 1 year away'),
  timezone: z.string().transform((value, ctx) => {
    const canonical = canonicalTimeZone(value);
    if (canonical) return canonical;
    ctx.addIssue({ code: 'custom', message: 'Must be an IANA time zone, for example America/New_York' });
    return z.NEVER;
  }),
  capacity: z.number().int().min(1).max(500),
}).meta({ id: 'CreateEvent' });

export type CreateEventInput = z.infer<typeof CreateEventBody>;

export const ChangeCapacityBody = z.strictObject({
  capacity: z.number().int().min(1).max(500),
}).meta({ id: 'ChangeCapacity' });

export const ListEventsQuery = z.strictObject({
  organizer: z.literal('me').optional(),
  scope: z.literal('past').optional(),
  limit: LimitQuery,
});

export const EventResponse = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.iso.datetime(),
  timezone: z.string(),
  capacity: z.number().int(),
  registeredCount: z.number().int(),
  seatsLeft: z.number().int(),
  organizer: z.object({ id: z.uuid(), name: z.string() }),
  myRegistration: z.object({ id: z.uuid(), status: z.literal('active') }).nullable(),
}).meta({ id: 'Event' });

export type EventView = z.infer<typeof EventResponse>;

export const EventListResponse = z.object({ events: z.array(EventResponse) }).meta({ id: 'EventList' });

// Names and times only: attendee emails stay private (R6).
export const AttendeeListResponse = z.object({
  registrations: z.array(
    z.object({
      id: z.uuid(),
      attendee: z.object({ id: z.uuid(), name: z.string() }),
      registeredAt: z.iso.datetime(),
    }),
  ),
}).meta({ id: 'AttendeeList' });

export type AttendeeList = z.infer<typeof AttendeeListResponse>;
