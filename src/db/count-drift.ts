import { sql } from 'kysely';
import type { Db } from './client.js';

export interface CountDrift {
  id: string;
  title: string;
  /** The count the guards use (registered_count or booked_count). */
  stored: number;
  /** The rows it must equal. */
  rows: number;
}

export interface CountDriftReport {
  events: CountDrift[];
  slots: CountDrift[];
}

/**
 * O3: every event whose registered_count differs from its active
 * registrations, and every delivery slot whose booked_count differs from its
 * orders that are not cancelled. Each list is one statement, so it reads one
 * snapshot: a registration committing meanwhile is counted on both sides or
 * on neither. Read-only.
 */
export async function findCountDrift(db: Db): Promise<CountDriftReport> {
  const events = await db
    .selectFrom('events as e')
    .leftJoin('registrations as r', (join) => join.onRef('r.event_id', '=', 'e.id').on('r.status', '=', 'active'))
    .select(['e.id', 'e.title', 'e.registered_count as stored', sql<string>`count(r.id)`.as('rows')])
    .groupBy('e.id')
    .having(sql<boolean>`e.registered_count <> count(r.id)`)
    .orderBy('e.id')
    .execute();

  const slots = await db
    .selectFrom('delivery_slots as s')
    .leftJoin('orders as o', (join) => join.onRef('o.slot_id', '=', 's.id').on('o.status', '<>', 'cancelled'))
    .select(['s.id', 's.title', 's.booked_count as stored', sql<string>`count(o.id)`.as('rows')])
    .groupBy('s.id')
    .having(sql<boolean>`s.booked_count <> count(o.id)`)
    .orderBy('s.id')
    .execute();

  // count() is a bigint, which pg returns as a string.
  const toDrift = (row: { id: string; title: string; stored: number; rows: string }): CountDrift => ({
    ...row,
    rows: Number(row.rows),
  });
  return { events: events.map(toDrift), slots: slots.map(toDrift) };
}
