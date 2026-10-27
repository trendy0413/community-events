import { describe, expect, it } from 'vitest';
import { createApi } from '../api/client';
import type { DemoPerson } from '../demo/people';
import { type Attempt, outcomeOf, PRESETS, type RaceDeps, runRace, tally, timing, verdict } from './race';

const organizer: DemoPerson = {
  id: 'organizer-id',
  name: 'Proof organizer',
  email: 'p@example.com',
  roles: ['organizer'],
};
const crowd: DemoPerson[] = Array.from({ length: 50 }, (_, i) => ({
  id: `person-${i + 1}`,
  name: `Crowd ${i + 1}`,
  email: `c${i + 1}@example.com`,
  roles: ['attendee'],
}));

/**
 * A stand-in server: it creates events with new ids and gives seats in the
 * order requests arrive. It only records what the page sends; the real seat
 * rule is tested against PostgreSQL in the API's tests.
 */
function fakeServer() {
  const created: { id: string; organizer: string | null }[] = [];
  const registrations: { eventId: string; person: string | null }[] = [];
  const seatsTaken = new Map<string, number>();
  const capacities = new Map<string, number>();

  const fetch = async (input: Request): Promise<Response> => {
    const url = new URL(input.url);
    const person = input.headers.get('X-Dev-User-Id');
    if (input.method === 'POST' && url.pathname === '/v1/events') {
      const body = (await input.json()) as { title: string; capacity: number };
      const id = `event-${created.length + 1}`;
      created.push({ id, organizer: person });
      capacities.set(id, body.capacity);
      return Response.json({ id, title: body.title, capacity: body.capacity }, { status: 201 });
    }
    const match = /^\/v1\/events\/([^/]+)\/registrations\/me$/.exec(url.pathname);
    if (input.method === 'PUT' && match?.[1]) {
      const eventId = match[1];
      registrations.push({ eventId, person });
      const taken = seatsTaken.get(eventId) ?? 0;
      if (taken >= (capacities.get(eventId) ?? 0)) {
        return Response.json(
          { type: 'about:blank', title: 'Conflict', status: 409, code: 'EVENT_FULL', detail: 'Full.' },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        );
      }
      seatsTaken.set(eventId, taken + 1);
      return Response.json({ id: `${eventId}-${person ?? ''}` }, { status: 201 });
    }
    return new Response(null, { status: 404 });
  };
  return { fetch, created, registrations };
}

function deps(server: ReturnType<typeof fakeServer>): RaceDeps {
  let tick = 0;
  return {
    api: createApi({ baseUrl: 'http://api.test', fetch: server.fetch as typeof fetch }),
    organizer,
    crowd,
    now: () => tick++,
    today: () => new Date('2026-10-27T12:00:00Z'),
  };
}

const [fiftyForTen] = PRESETS;
if (!fiftyForTen) throw new Error('PRESETS changed: update this test');

describe('proof race', () => {
  it('W3 each proof run creates its own event', async () => {
    const server = fakeServer();

    const first = await runRace(deps(server), fiftyForTen);
    const second = await runRace(deps(server), fiftyForTen);

    expect(server.created).toEqual([
      { id: 'event-1', organizer: 'organizer-id' },
      { id: 'event-2', organizer: 'organizer-id' },
    ]);
    expect(first.eventId).not.toBe(second.eventId);
    for (const run of [first, second]) {
      const sent = server.registrations.filter((r) => r.eventId === run.eventId);
      // Each person registers once, as themselves, on this run's event only.
      expect(sent).toHaveLength(50);
      expect(new Set(sent.map((r) => r.person)).size).toBe(50);
      expect(tally(run.attempts)).toEqual({ seat: 10, full: 40, error: 0 });
    }
  });

  it('W4 badge shows only when all three counts equal the capacity', () => {
    expect(verdict(10, 10, { registeredCount: 10, activeRows: 10 }).noOverbooking).toBe(true);

    for (const [seats, registeredCount, activeRows] of [
      [11, 10, 10],
      [10, 11, 10],
      [10, 10, 11],
      [9, 9, 9],
    ] as const) {
      const result = verdict(10, seats, { registeredCount, activeRows });
      expect(result.noOverbooking, `${seats}/${registeredCount}/${activeRows}`).toBe(false);
      expect(result.numbers.filter((n) => !n.matches).length).toBeGreaterThan(0);
    }
  });

  it('counts only 201 as a seat and only 409 EVENT_FULL as full', () => {
    expect(outcomeOf(201, null)).toBe('seat');
    expect(outcomeOf(409, 'EVENT_FULL')).toBe('full');
    expect(outcomeOf(409, 'EVENT_STARTED')).toBe('error');
    expect(outcomeOf(200, null)).toBe('error');
    expect(outcomeOf(429, null)).toBe('error');
    expect(outcomeOf(0, null)).toBe('error');
  });

  it('measures how many requests were waiting at the same moment', () => {
    const at = (sentAt: number, doneAt: number) => ({ sentAt, doneAt }) as Attempt;

    expect(timing([at(0, 10), at(1, 11), at(2, 12)])).toEqual({ spreadMs: 2, totalMs: 12, peakInFlight: 3 });
    // One after another: never more than one open.
    expect(timing([at(0, 5), at(5, 9), at(9, 12)]).peakInFlight).toBe(1);
    expect(timing([])).toEqual({ spreadMs: 0, totalMs: 0, peakInFlight: 0 });
  });
});
