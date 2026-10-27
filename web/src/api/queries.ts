import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentPerson } from '../identity';
import { api, ApiError, type Schemas, unwrap } from './client';

// TanStack Query hooks, one per API call. Keys start with the person's id,
// so switching person never shows the previous person's data.

function usePersonKey(): string {
  return useCurrentPerson()?.id ?? 'nobody';
}

/** Retries only answers that a retry can change: no answer, or the database waking up. */
function retryTransient(failures: number, error: unknown): boolean {
  return failures < 3 && error instanceof ApiError && (error.status === 0 || error.status === 503);
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => unwrap(api.GET('/v1/health')),
    // A database that scales to zero can take a few seconds to wake.
    retry: (failures, error) => failures < 5 && retryTransient(0, error),
    retryDelay: 1500,
    refetchInterval: 60_000,
  });
}

export function useMe() {
  const person = usePersonKey();
  return useQuery({
    queryKey: [person, 'me'],
    queryFn: () => unwrap(api.GET('/v1/me')),
    enabled: person !== 'nobody',
    retry: retryTransient,
  });
}

export function useEvents(filter: { organizer?: 'me' } = {}) {
  const person = usePersonKey();
  return useQuery({
    queryKey: [person, 'events', filter],
    queryFn: () => unwrap(api.GET('/v1/events', { params: { query: { ...filter, limit: 50 } } })),
    retry: retryTransient,
  });
}

export function useEvent(id: string) {
  const person = usePersonKey();
  return useQuery({
    queryKey: [person, 'event', id],
    queryFn: () => unwrap(api.GET('/v1/events/{id}', { params: { path: { id } } })),
    retry: retryTransient,
  });
}

export function useAttendees(id: string, enabled = true) {
  const person = usePersonKey();
  return useQuery({
    queryKey: [person, 'attendees', id],
    queryFn: () => unwrap(api.GET('/v1/events/{id}/registrations', { params: { path: { id } } })),
    enabled,
    retry: retryTransient,
  });
}

export function useMyRegistrations() {
  const person = usePersonKey();
  return useQuery({
    queryKey: [person, 'my-registrations'],
    queryFn: () => unwrap(api.GET('/v1/me/registrations', { params: { query: { limit: 50 } } })),
    retry: retryTransient,
  });
}

export function useUsers() {
  const person = usePersonKey();
  return useQuery({
    queryKey: [person, 'users'],
    queryFn: () => unwrap(api.GET('/v1/users')),
    retry: retryTransient,
  });
}

/** After a write, everything this person sees may have changed: seat counts, lists, their registrations. */
function useRefreshAll() {
  const client = useQueryClient();
  return () => client.invalidateQueries();
}

export function useRegister(eventId: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: () => unwrap(api.PUT('/v1/events/{id}/registrations/me', { params: { path: { id: eventId } } })),
    onSettled: refresh,
  });
}

export function useCancel(eventId: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: () => unwrap(api.DELETE('/v1/events/{id}/registrations/me', { params: { path: { id: eventId } } })),
    onSettled: refresh,
  });
}

export function useCreateEvent() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: Schemas['CreateEventInput']) => unwrap(api.POST('/v1/events', { body })),
    onSuccess: refresh,
  });
}

export function useChangeCapacity(eventId: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (capacity: number) =>
      unwrap(api.PATCH('/v1/events/{id}', { params: { path: { id: eventId } }, body: { capacity } })),
    onSettled: refresh,
  });
}
