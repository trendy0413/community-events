import { describe, expect, it } from 'vitest';
import { loadSeedData } from '../../src/db/seed.js';

describe('seed data', () => {
  it('W5 seed data holds only @example.com people', () => {
    const { people } = loadSeedData();

    expect(people.length).toBeGreaterThan(0);
    for (const person of people) expect(person.email).toMatch(/@example\.com$/);
  });

  it('gives every seeded event an organizer who has the organizer role', () => {
    const { people, events } = loadSeedData();
    const organizers = new Set(people.filter((p) => p.roles.includes('organizer')).map((p) => p.id));

    for (const event of events) expect(organizers.has(event.organizerId)).toBe(true);
  });
});
