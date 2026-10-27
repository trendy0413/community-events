import { describe, expect, it } from 'vitest';
import { createApi } from '../api/client';
import type { DemoPerson } from '../demo/people';
import { type Claim, claimOutcome, exactlyOneDriver, runDriverRace } from './drivers';

const person = (id: string, roles: string[]): DemoPerson => ({ id, name: id, email: '', roles });
const drivers = Array.from({ length: 5 }, (_, i) => person(`driver-${i + 1}`, ['driver']));
const claim = (n: number, outcome: Claim['outcome']): Claim => ({
  driver: person(`driver-${n}`, ['driver']),
  status: 0,
  code: null,
  outcome,
});

/**
 * A stand-in server: new slots and orders get new ids, and the first claim
 * of an order wins. It only records what the page sends; the real rule is
 * tested against PostgreSQL in the API's tests.
 */
function fakeServer() {
  const slots: string[] = [];
  const orders = new Map<string, { slot: string; driver: string | null }>();
  const claims: { order: string; driver: string | null }[] = [];
  const answer = (input: Request): Response => {
    const { pathname } = new URL(input.url);
    const who = input.headers.get('X-Dev-User-Id');
    if (input.method === 'POST' && pathname === '/v1/slots') {
      const id = `slot-${slots.length + 1}`;
      slots.push(id);
      return Response.json({ id }, { status: 201 });
    }
    const placed = /^\/v1\/slots\/([^/]+)\/orders\/([^/]+)$/.exec(pathname);
    if (input.method === 'PUT' && placed?.[1] && placed[2]) {
      orders.set(placed[2], { slot: placed[1], driver: null });
      return Response.json({ id: placed[2] }, { status: 201 });
    }
    const claimed = /^\/v1\/jobs\/([^/]+)\/driver$/.exec(pathname);
    if (input.method === 'PUT' && claimed?.[1]) {
      claims.push({ order: claimed[1], driver: who });
      const order = orders.get(claimed[1]);
      if (order && !order.driver) {
        order.driver = who;
        return Response.json({ id: claimed[1] }, { status: 200 });
      }
      return Response.json(
        { type: 'about:blank', title: 'Conflict', status: 409, code: 'JOB_TAKEN', detail: 'Taken.' },
        { status: 409, headers: { 'content-type': 'application/problem+json' } },
      );
    }
    const listed = /^\/v1\/slots\/([^/]+)\/orders$/.exec(pathname);
    if (input.method === 'GET' && listed?.[1]) {
      const rows = [...orders.entries()]
        .filter(([, order]) => order.slot === listed[1])
        .map(([id, order]) => ({
          id,
          status: order.driver ? 'claimed' : 'booked',
          driver: order.driver ? { id: order.driver, name: order.driver } : null,
        }));
      return Response.json({ orders: rows });
    }
    return new Response(null, { status: 404 });
  };
  const fetch = (input: Request): Promise<Response> => Promise.resolve(answer(input));
  return { fetch, slots, orders, claims };
}

describe('driver race', () => {
  it('W3 each driver race creates its own slot and order', async () => {
    const server = fakeServer();
    let ids = 0;
    const deps = {
      api: createApi({ baseUrl: 'http://api.test', fetch: server.fetch as typeof fetch }),
      supplier: person('supplier', ['supplier']),
      contractor: person('contractor', ['contractor']),
      drivers,
      today: () => new Date('2026-10-27T12:00:00Z'),
      newId: () => `order-${++ids}`,
    };

    const first = await runDriverRace(deps);
    const second = await runDriverRace(deps);

    expect(server.slots).toEqual(['slot-1', 'slot-2']);
    expect([first.orderId, second.orderId]).toEqual(['order-1', 'order-2']);
    for (const run of [first, second]) {
      const sent = server.claims.filter((c) => c.order === run.orderId);
      // Every driver claims once, as themselves, this run's order only.
      expect(sent.map((c) => c.driver).sort()).toEqual(drivers.map((d) => d.id).sort());
      expect(exactlyOneDriver(run)).toBe(true);
    }
  });

  it('counts only 200 as getting the job and only 409 JOB_TAKEN as taken', () => {
    expect(claimOutcome(200, null)).toBe('got');
    expect(claimOutcome(409, 'JOB_TAKEN')).toBe('taken');
    expect(claimOutcome(409, 'JOB_NOT_OPEN')).toBe('error');
    expect(claimOutcome(403, 'FORBIDDEN')).toBe('error');
    expect(claimOutcome(0, null)).toBe('error');
  });

  it('W6 badge shows only when one driver got the job and the order read back is claimed by that driver', () => {
    const fair = [claim(1, 'taken'), claim(2, 'got'), claim(3, 'taken')];
    const claimedBy = (id: string) => ({ status: 'claimed', driver: { id, name: id } });
    expect(exactlyOneDriver({ claims: fair, readBack: claimedBy('driver-2') })).toBe(true);

    expect(exactlyOneDriver({ claims: fair, readBack: claimedBy('driver-1') })).toBe(false);
    expect(exactlyOneDriver({ claims: fair, readBack: { status: 'cancelled', driver: null } })).toBe(false);
    expect(exactlyOneDriver({ claims: fair, readBack: null })).toBe(false);
    expect(exactlyOneDriver({ claims: [claim(1, 'got'), claim(2, 'got')], readBack: claimedBy('driver-1') })).toBe(
      false,
    );
    expect(exactlyOneDriver({ claims: [claim(1, 'got'), claim(2, 'error')], readBack: claimedBy('driver-1') })).toBe(
      false,
    );
  });
});
