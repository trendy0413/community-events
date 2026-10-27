import { z } from 'zod';
import { LimitQuery } from '../../http/schemas.js';
import type { MyRegistration, Registration } from './repository.js';

export const MyRegistrationsQuery = z.strictObject({ limit: LimitQuery });

export const MyRegistrationsResponse = z.object({
  registrations: z.array(
    z.object({
      id: z.uuid(),
      status: z.enum(['active', 'cancelled']),
      createdAt: z.iso.datetime(),
      cancelledAt: z.iso.datetime().nullable(),
      event: z.object({ id: z.uuid(), title: z.string(), startsAt: z.iso.datetime(), timezone: z.string() }),
    }),
  ),
});

export function toMyRegistrationsResponse(rows: MyRegistration[]): z.infer<typeof MyRegistrationsResponse> {
  return {
    registrations: rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      event: { ...row.event, startsAt: row.event.startsAt.toISOString() },
    })),
  };
}

export const RegistrationResponse = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  attendeeId: z.uuid(),
  status: z.enum(['active', 'cancelled']),
  createdAt: z.iso.datetime(),
  cancelledAt: z.iso.datetime().nullable(),
});

export function toRegistrationResponse(registration: Registration): z.infer<typeof RegistrationResponse> {
  return {
    id: registration.id,
    eventId: registration.eventId,
    attendeeId: registration.attendeeId,
    status: registration.status,
    createdAt: registration.createdAt.toISOString(),
    cancelledAt: registration.cancelledAt?.toISOString() ?? null,
  };
}
