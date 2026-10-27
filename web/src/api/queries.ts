import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { setCurrentPerson, useCurrentPerson } from '../identity';
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

export function useEvents(filter: { organizer?: 'me'; scope?: 'past' } = {}) {
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

/** Picks who you are (W2). The previous person's answers are dropped, so they never show for the new one. */
export function useSwitchPerson() {
  const client = useQueryClient();
  return (id: string | null) => {
    setCurrentPerson(id);
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'health' });
  };
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

// The jobsite supply flow (SPEC section 14).

export function useSlots(filter: { supplier?: 'me' } = {}) {
  const person = usePersonKey();
  return useQuery({
    queryKey: [person, 'slots', filter],
    queryFn: () => unwrap(api.GET('/v1/slots', { params: { query: { ...filter, limit: 50 } } })),
    retry: retryTransient,
  });
}

export function useSlotOrders(slotId: string, enabled = true) {
  const person = usePersonKey();
  return useQuery({
    queryKey: [person, 'slot-orders', slotId],
    queryFn: () => unwrap(api.GET('/v1/slots/{id}/orders', { params: { path: { id: slotId } } })),
    enabled,
    retry: retryTransient,
  });
}

export function useMyOrders() {
  const person = usePersonKey();
  return useQuery({
    queryKey: [person, 'my-orders'],
    queryFn: () => unwrap(api.GET('/v1/me/orders', { params: { query: { limit: 50 } } })),
    retry: retryTransient,
  });
}

export function useJobs() {
  const person = usePersonKey();
  return useQuery({
    queryKey: [person, 'jobs'],
    queryFn: () => unwrap(api.GET('/v1/jobs')),
    retry: retryTransient,
  });
}

export function useCreateSlot() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: Schemas['CreateSlotInput']) => unwrap(api.POST('/v1/slots', { body })),
    onSuccess: refresh,
  });
}

/**
 * The caller names the order with its own id (S2) and sends the same id when
 * it tries again, so a retry never books a second delivery.
 */
export function usePlaceOrder(slotId: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ orderId, body }: { orderId: string; body: Schemas['PlaceOrderInput'] }) =>
      unwrap(api.PUT('/v1/slots/{id}/orders/{orderId}', { params: { path: { id: slotId, orderId } }, body })),
    onSettled: refresh,
  });
}

export function useCancelOrder(orderId: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: () => unwrap(api.DELETE('/v1/orders/{orderId}', { params: { path: { orderId } } })),
    onSettled: refresh,
  });
}

export function useClaimJob(orderId: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: () => unwrap(api.PUT('/v1/jobs/{orderId}/driver', { params: { path: { orderId } } })),
    onSettled: refresh,
  });
}

export function useMarkDelivered(orderId: string) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: () => unwrap(api.PUT('/v1/jobs/{orderId}/delivered', { params: { path: { orderId } } })),
    onSettled: refresh,
  });
}
