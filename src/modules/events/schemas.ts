import { z } from 'zod';
import { FutureStart, LimitQuery, NO_NUL, TimeZoneName } from '../../http/schemas.js';

// R10. strictObject rejects unknown fields, so a typo in a field name is an
// error instead of a silently ignored value.
export const CreateEventBody = z.strictObject({
  title: z.string().trim().min(3).max(80).refine(...NO_NUL),
  // An empty description is stored as "no description" (null), the same as
  // leaving it out.
  description: z
    .string()
    .trim()
    .max(500)
    .refine(...NO_NUL)
    .nullish()
    .transform((value) => value || null),
  startsAt: FutureStart,
  timezone: TimeZoneName,
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
