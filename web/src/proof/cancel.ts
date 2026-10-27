import { as, unwrap } from '../api/client';
import type { DemoPerson } from '../demo/people';
import { type Attempt, type RaceDeps, register } from './race';

// Panel 2: on the event of the last race, cancel one seat twice, then let
// everyone who was told "full" try again at once. Each step records the
// server's answer and the event's count read back afterwards.

export interface CancelStep {
  label: string;
  /** The answers to this step's calls, as "204" or "201 × 1, 409 × 39". */
  answers: string;
  /** The event's registeredCount read back after the step. */
  countAfter: number;
}

export async function cancelAs(deps: RaceDeps, eventId: string, person: DemoPerson): Promise<number> {
  try {
    const { response } = await deps.api.DELETE('/v1/events/{id}/registrations/me', {
      params: { path: { id: eventId } },
      ...as(person.id),
    });
    return response.status;
  } catch {
    return 0;
  }
}

export async function countOf(deps: RaceDeps, eventId: string): Promise<number> {
  const event = await unwrap(
    deps.api.GET('/v1/events/{id}', { params: { path: { id: eventId } }, ...as(deps.organizer.id) }),
  );
  return event.registeredCount;
}

/** "201 × 1, 409 × 39": how many calls got each status, in status order. */
export function summarize(statuses: number[]): string {
  const counts = new Map<number, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([status, count]) => `${status || 'no answer'} × ${count}`)
    .join(', ');
}

export async function cancelOnce(deps: RaceDeps, eventId: string, person: DemoPerson): Promise<CancelStep> {
  const status = await cancelAs(deps, eventId, person);
  return { label: `${person.name} cancels`, answers: summarize([status]), countAfter: await countOf(deps, eventId) };
}

export async function retryFull(deps: RaceDeps, eventId: string, told: DemoPerson[]): Promise<CancelStep> {
  const attempts: Attempt[] = await Promise.all(told.map((person) => register(deps, eventId, person)));
  return {
    label: `The ${told.length} who were told "full" try again at once`,
    answers: summarize(attempts.map((a) => a.status)),
    countAfter: await countOf(deps, eventId),
  };
}
