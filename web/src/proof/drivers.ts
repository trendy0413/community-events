import { type Api, as, isProblem, unwrap } from '../api/client';
import type { DemoPerson } from '../demo/people';
import { PROOF_EVENT_START_DAYS } from './race';

// The supply race (SPEC S4): one order, and every driver tries to take the
// job at the same moment. The page records the answers and reads the order
// back; the server decides who gets it (W1).

export interface DriverRaceDeps {
  api: Api;
  supplier: DemoPerson;
  contractor: DemoPerson;
  drivers: DemoPerson[];
  today: () => Date;
  /** A new order id; the order is new for every run (W3). */
  newId: () => string;
}

export type ClaimOutcome = 'got' | 'taken' | 'error';

export interface Claim {
  driver: DemoPerson;
  status: number;
  code: string | null;
  outcome: ClaimOutcome;
}

export interface DriverRace {
  slotId: string;
  orderId: string;
  claims: Claim[];
  /** The order as the server shows it afterwards: its status and its driver. */
  readBack: { status: string; driver: { id: string; name: string } | null } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** W3: each run publishes its own slot and places its own order, so runs never mix. */
export async function runDriverRace(deps: DriverRaceDeps): Promise<DriverRace> {
  const slot = await unwrap(
    deps.api.POST('/v1/slots', {
      body: {
        title: `Proof job ${deps.today().toISOString().slice(11, 19)} UTC`,
        area: 'Proof page',
        startsAt: new Date(deps.today().getTime() + PROOF_EVENT_START_DAYS * DAY_MS).toISOString(),
        timezone: 'UTC',
        capacity: 1,
      },
      ...as(deps.supplier.id),
    }),
  );
  const orderId = deps.newId();
  await unwrap(
    deps.api.PUT('/v1/slots/{id}/orders/{orderId}', {
      params: { path: { id: slot.id, orderId } },
      body: { items: 'One pallet of cement', jobsite: 'Proof page, gate A' },
      ...as(deps.contractor.id),
    }),
  );

  // All claims start in this one loop, before any answer can arrive.
  const claims = await Promise.all(deps.drivers.map((driver) => claimAs(deps, orderId, driver)));

  const orders = await unwrap(
    deps.api.GET('/v1/slots/{id}/orders', { params: { path: { id: slot.id } }, ...as(deps.supplier.id) }),
  );
  const order = orders.orders.find((row) => row.id === orderId);
  return {
    slotId: slot.id,
    orderId,
    claims,
    readBack: order ? { status: order.status, driver: order.driver } : null,
  };
}

async function claimAs(deps: DriverRaceDeps, orderId: string, driver: DemoPerson): Promise<Claim> {
  try {
    const { response, error } = await deps.api.PUT('/v1/jobs/{orderId}/driver', {
      params: { path: { orderId } },
      ...as(driver.id),
    });
    const code = isProblem(error) ? error.code : null;
    return { driver, status: response.status, code, outcome: claimOutcome(response.status, code) };
  } catch {
    return { driver, status: 0, code: null, outcome: 'error' };
  }
}

export function claimOutcome(status: number, code: string | null): ClaimOutcome {
  if (status === 200) return 'got';
  if (status === 409 && code === 'JOB_TAKEN') return 'taken';
  return 'error';
}

/**
 * W6: "Exactly one driver" only when one claim got 200, every other was told
 * the job is taken, and the order read back is claimed by that same driver.
 * It compares answers the server gave; it is not the rule itself (W1).
 */
export function exactlyOneDriver(race: Pick<DriverRace, 'claims' | 'readBack'>): boolean {
  const winners = race.claims.filter((claim) => claim.outcome === 'got');
  const taken = race.claims.filter((claim) => claim.outcome === 'taken');
  return (
    winners.length === 1 &&
    taken.length === race.claims.length - 1 &&
    race.readBack?.status === 'claimed' &&
    winners[0]?.driver.id === race.readBack.driver?.id
  );
}
