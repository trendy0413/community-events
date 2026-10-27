import { as } from '../api/client';
import type { DemoPerson } from '../demo/people';
import { createProofEvent, type RaceDeps } from './race';

// Panel 3: five actions, tried live by four people. The expected answers are
// written here from SPEC section 4, not read from the server, so the check
// is not circular. The page only compares; the server decides (W1).

export type Column = 'owner' | 'otherOrganizer' | 'attendee' | 'admin';
export type Expected = 'allowed' | 'denied';

export const COLUMNS: { id: Column; label: string }[] = [
  { id: 'owner', label: 'Organizer who owns the event' },
  { id: 'otherOrganizer', label: 'Another organizer' },
  { id: 'attendee', label: 'Attendee' },
  { id: 'admin', label: 'Admin' },
];

const MINUTE_MS = 60 * 1000;

export interface Check {
  id: string;
  label: string;
  rule: string;
  expected: Record<Column, Expected>;
  /** Sends the call as the person; returns the HTTP status (0 when no answer came). */
  run: (deps: RaceDeps, eventId: string, eventCapacity: number, person: DemoPerson) => Promise<number>;
}

async function statusOf(call: Promise<{ response: Response }>): Promise<number> {
  try {
    return (await call).response.status;
  } catch {
    return 0;
  }
}

export const CHECKS: Check[] = [
  {
    id: 'create',
    label: 'Create an event',
    rule: 'R5',
    expected: { owner: 'allowed', otherOrganizer: 'allowed', attendee: 'denied', admin: 'denied' },
    // Starts in a few minutes, so a created event soon leaves the upcoming lists.
    run: (deps, _eventId, _capacity, person) =>
      statusOf(
        deps.api.POST('/v1/events', {
          body: {
            title: 'Permission check (proof page)',
            startsAt: new Date(deps.today().getTime() + 5 * MINUTE_MS).toISOString(),
            timezone: 'UTC',
            capacity: 1,
          },
          ...as(person.id),
        }),
      ),
  },
  {
    id: 'capacity',
    label: "Change this event's capacity",
    rule: 'R5',
    expected: { owner: 'allowed', otherOrganizer: 'denied', attendee: 'denied', admin: 'denied' },
    // The same capacity again, so an allowed call changes nothing.
    run: (deps, eventId, capacity, person) =>
      statusOf(
        deps.api.PATCH('/v1/events/{id}', { params: { path: { id: eventId } }, body: { capacity }, ...as(person.id) }),
      ),
  },
  {
    id: 'attendees',
    label: 'See who registered',
    rule: 'R6',
    expected: { owner: 'allowed', otherOrganizer: 'denied', attendee: 'denied', admin: 'allowed' },
    run: (deps, eventId, _capacity, person) =>
      statusOf(deps.api.GET('/v1/events/{id}/registrations', { params: { path: { id: eventId } }, ...as(person.id) })),
  },
  {
    id: 'register',
    label: 'Register for this event',
    rule: 'section 4',
    expected: { owner: 'denied', otherOrganizer: 'denied', attendee: 'allowed', admin: 'denied' },
    run: (deps, eventId, _capacity, person) =>
      statusOf(
        deps.api.PUT('/v1/events/{id}/registrations/me', { params: { path: { id: eventId } }, ...as(person.id) }),
      ),
  },
  {
    id: 'users',
    label: 'See all users and their emails',
    rule: 'R6',
    expected: { owner: 'denied', otherOrganizer: 'denied', attendee: 'denied', admin: 'allowed' },
    run: (deps, _eventId, _capacity, person) => statusOf(deps.api.GET('/v1/users', as(person.id))),
  },
];

/** 403 means denied. Any other answer from the server means the permission check passed. */
export function judge(status: number): Expected | 'no answer' {
  if (status === 0) return 'no answer';
  return status === 403 ? 'denied' : 'allowed';
}

export interface Cell {
  status: number;
  actual: Expected | 'no answer';
  matches: boolean;
}

export async function runChecks(
  deps: RaceDeps,
  people: Record<Column, DemoPerson>,
): Promise<{ eventId: string; cells: Record<string, Record<Column, Cell>> }> {
  // The checks run on an event of their own (W3), owned by the "owner" column.
  const event = await createProofEvent({ ...deps, organizer: people.owner }, 1, 'Permission checks (proof page)');
  const rows = await Promise.all(
    CHECKS.map(async (check) => {
      const row = await Promise.all(
        COLUMNS.map(async ({ id }) => {
          const status = await check.run(deps, event.id, event.capacity, people[id]);
          const actual = judge(status);
          return [id, { status, actual, matches: actual === check.expected[id] }] as const;
        }),
      );
      return [check.id, Object.fromEntries(row) as Record<Column, Cell>] as const;
    }),
  );
  const cells = Object.fromEntries(rows);
  return { eventId: event.id, cells };
}
