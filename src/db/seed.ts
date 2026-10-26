import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Db } from './client.js';
import { ROLES } from './schema.js';

const SEED_FILE = path.resolve(import.meta.dirname, '../../seed/personas.json');

const SeedSchema = z.object({
  people: z.array(
    z.object({
      id: z.uuid(),
      name: z.string().min(1),
      email: z.email(),
      roles: z.array(z.enum(ROLES)).min(1),
    }),
  ),
  events: z.array(
    z.object({
      id: z.uuid(),
      organizerId: z.uuid(),
      title: z.string().min(3).max(80),
      description: z.string().max(500),
      startsInDays: z.number().int().min(1).max(300),
      timezone: z.string().min(1),
      capacity: z.number().int().min(1).max(500),
    }),
  ),
});

export type SeedData = z.infer<typeof SeedSchema>;

export function loadSeedData(): SeedData {
  return SeedSchema.parse(JSON.parse(readFileSync(SEED_FILE, 'utf8')));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Upserts the demo people and events. Safe to run again: fixed IDs, and
 * events move forward so they stay upcoming. Registrations are not seeded
 * here; registered_count must change only through the registration service.
 */
export async function seed(db: Db, now: Date = new Date()): Promise<{ people: number; events: number }> {
  const data = loadSeedData();
  // Whole hours read better on event pages than the second the seed ran.
  const startOfHour = Math.ceil(now.getTime() / HOUR_MS) * HOUR_MS;

  // One statement per table: the database may be far away, and each round
  // trip costs more than the rows themselves.
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('users')
      .values(data.people)
      .onConflict((oc) =>
        oc.column('id').doUpdateSet((eb) => ({
          name: eb.ref('excluded.name'),
          email: eb.ref('excluded.email'),
          roles: eb.ref('excluded.roles'),
        })),
      )
      .execute();

    await trx
      .insertInto('events')
      .values(
        data.events.map((event) => ({
          id: event.id,
          organizer_id: event.organizerId,
          title: event.title,
          description: event.description,
          starts_at: new Date(startOfHour + event.startsInDays * DAY_MS),
          timezone: event.timezone,
          capacity: event.capacity,
        })),
      )
      // Capacity is left alone on conflict: lowering it below the seats
      // already taken would break the capacity CHECK.
      .onConflict((oc) =>
        oc.column('id').doUpdateSet((eb) => ({
          title: eb.ref('excluded.title'),
          description: eb.ref('excluded.description'),
          starts_at: eb.ref('excluded.starts_at'),
          timezone: eb.ref('excluded.timezone'),
          updated_at: new Date(),
        })),
      )
      .execute();
  });

  return { people: data.people.length, events: data.events.length };
}
