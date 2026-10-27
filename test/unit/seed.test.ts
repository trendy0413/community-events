import { describe, expect, it } from 'vitest';
import { loadSeedData, seedPeople } from '../../src/db/seed.js';

describe('seed data', () => {
  it('W5 seed data holds only @example.com people', () => {
    const people = seedPeople(loadSeedData());

    expect(people.length).toBeGreaterThan(0);
    for (const person of people) expect(person.email).toMatch(/@example\.com$/);
  });

  it('gives every person their own id and email', () => {
    const people = seedPeople(loadSeedData());

    expect(new Set(people.map((p) => p.id)).size).toBe(people.length);
    expect(new Set(people.map((p) => p.email.toLowerCase())).size).toBe(people.length);
  });

  it('gives every seeded event an organizer who has the organizer role', () => {
    const data = loadSeedData();
    const organizers = new Set(
      seedPeople(data)
        .filter((p) => p.roles.includes('organizer'))
        .map((p) => p.id),
    );

    for (const event of data.events) expect(organizers.has(event.organizerId)).toBe(true);
  });

  it('gives proof runs an organizer and a crowd of 50 who can only attend', () => {
    const { proofOrganizer, crowd } = loadSeedData();

    expect(proofOrganizer.roles).toEqual(['organizer']);
    expect(crowd).toHaveLength(50);
    for (const person of crowd) expect(person.roles).toEqual(['attendee']);
  });
});
