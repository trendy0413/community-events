import { z } from 'zod';
import type { Registration } from './repository.js';

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
