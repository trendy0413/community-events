import { type Api, as, isProblem, unwrap } from '../api/client';
import type { DemoPerson } from '../demo/people';

// The proof page's race: one new event, then one registration per person,
// all sent at the same moment. Everything here records what the server
// answered; nothing decides who gets a seat (W1).

export interface Preset {
  id: string;
  label: string;
  capacity: number;
  people: number;
}

export const PRESETS: Preset[] = [
  { id: '50-for-10', label: '50 people, 10 seats', capacity: 10, people: 50 },
  { id: '20-for-1', label: '20 people, 1 seat', capacity: 1, people: 20 },
];

export type Outcome = 'seat' | 'full' | 'error';

export interface Attempt {
  person: DemoPerson;
  /** HTTP status; 0 when no answer came back. */
  status: number;
  code: string | null;
  outcome: Outcome;
  /** Milliseconds on the page's clock. */
  sentAt: number;
  doneAt: number;
  body: unknown;
}

export interface Race {
  eventId: string;
  title: string;
  capacity: number;
  attempts: Attempt[];
}

export interface RaceDeps {
  api: Api;
  organizer: DemoPerson;
  crowd: DemoPerson[];
  /** A monotonic clock in milliseconds, for timings. */
  now: () => number;
  /** Wall-clock time, for the event's title and start. */
  today: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** W3: every run gets its own event, so runs by different visitors never mix. */
export async function createProofEvent(deps: RaceDeps, capacity: number, title: string) {
  const start = new Date(deps.today().getTime() + 30 * DAY_MS);
  return unwrap(
    deps.api.POST('/v1/events', {
      body: {
        title,
        description: 'Created by the proof page. Each run makes its own event.',
        startsAt: start.toISOString(),
        timezone: 'UTC',
        capacity,
      },
      ...as(deps.organizer.id),
    }),
  );
}

export async function runRace(deps: RaceDeps, preset: Preset): Promise<Race> {
  const title = `Proof run ${deps.today().toISOString().slice(11, 19)} UTC`;
  const event = await createProofEvent(deps, preset.capacity, title);
  // All calls start in this one loop, before any answer can arrive.
  const attempts = await Promise.all(
    deps.crowd.slice(0, preset.people).map((person) => register(deps, event.id, person)),
  );
  return { eventId: event.id, title: event.title, capacity: event.capacity, attempts };
}

/** One registration, sent as the given person. */
export async function register(deps: RaceDeps, eventId: string, person: DemoPerson): Promise<Attempt> {
  const sentAt = deps.now();
  try {
    const { response, data, error } = await deps.api.PUT('/v1/events/{id}/registrations/me', {
      params: { path: { id: eventId } },
      ...as(person.id),
    });
    const code = isProblem(error) ? error.code : null;
    return {
      person,
      status: response.status,
      code,
      outcome: outcomeOf(response.status, code),
      sentAt,
      doneAt: deps.now(),
      body: response.ok ? data : error,
    };
  } catch {
    return { person, status: 0, code: null, outcome: 'error', sentAt, doneAt: deps.now(), body: null };
  }
}

export function outcomeOf(status: number, code: string | null): Outcome {
  if (status === 201) return 'seat';
  if (status === 409 && code === 'EVENT_FULL') return 'full';
  // Anything else, a 200 "already registered" included, is not what a race
  // of different people should get, so it shows as an error.
  return 'error';
}

export function tally(attempts: Attempt[]): Record<Outcome, number> {
  const counts: Record<Outcome, number> = { seat: 0, full: 0, error: 0 };
  for (const attempt of attempts) counts[attempt.outcome] += 1;
  return counts;
}

export interface Timing {
  /** From the first request sent to the last one sent. */
  spreadMs: number;
  /** From the first request sent to the last answer. */
  totalMs: number;
  /** The most requests that were waiting for an answer at the same moment. */
  peakInFlight: number;
}

export function timing(attempts: Attempt[]): Timing {
  if (attempts.length === 0) return { spreadMs: 0, totalMs: 0, peakInFlight: 0 };
  const firstSent = Math.min(...attempts.map((a) => a.sentAt));
  const lastSent = Math.max(...attempts.map((a) => a.sentAt));
  const lastDone = Math.max(...attempts.map((a) => a.doneAt));

  // Sweep over start (+1) and end (-1) points; at equal times, ends first.
  const points = attempts.flatMap((a) => [
    { at: a.sentAt, step: 1 },
    { at: a.doneAt, step: -1 },
  ]);
  points.sort((x, y) => x.at - y.at || x.step - y.step);
  let inFlight = 0;
  let peakInFlight = 0;
  for (const point of points) {
    inFlight += point.step;
    peakInFlight = Math.max(peakInFlight, inFlight);
  }
  return { spreadMs: lastSent - firstSent, totalMs: lastDone - firstSent, peakInFlight };
}

export interface ReadBack {
  /** The event's stored seat count. */
  registeredCount: number;
  /** Active registrations in the attendee list. */
  activeRows: number;
}

/** Reads the event and its attendee list back, as the organizer who owns it. */
export async function readBack(deps: RaceDeps, eventId: string): Promise<ReadBack> {
  const [event, attendees] = await Promise.all([
    unwrap(deps.api.GET('/v1/events/{id}', { params: { path: { id: eventId } }, ...as(deps.organizer.id) })),
    unwrap(
      deps.api.GET('/v1/events/{id}/registrations', { params: { path: { id: eventId } }, ...as(deps.organizer.id) }),
    ),
  ]);
  return { registeredCount: event.registeredCount, activeRows: attendees.registrations.length };
}

export interface CheckedNumber {
  label: string;
  value: number;
  /** Whether this number equals the capacity. */
  matches: boolean;
}

export interface Verdict {
  noOverbooking: boolean;
  numbers: CheckedNumber[];
}

/**
 * W4: "No overbooking" only when all three numbers equal the capacity: the
 * seats the responses gave out, the event's count, and the attendee list.
 * It compares numbers the server returned; it is not a seat rule (W1).
 */
export function verdict(capacity: number, seatsGiven: number, back: ReadBack): Verdict {
  const numbers = [
    { label: 'Got a seat (201 answers)', value: seatsGiven },
    { label: "Event's registered count", value: back.registeredCount },
    { label: 'Active rows in the attendee list', value: back.activeRows },
  ].map((n) => ({ ...n, matches: n.value === capacity }));
  return { noOverbooking: numbers.every((n) => n.matches), numbers };
}
