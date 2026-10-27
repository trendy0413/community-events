import { describe, expect, it } from 'vitest';
import { type Action, type Actor, can } from '../../src/auth/policy.js';
import type { Role } from '../../src/db/schema.js';

const person = (id: string, roles: Role[]): Actor => ({ id, name: id, email: `${id}@example.com`, roles });

const people = {
  attendee: person('attendee', ['attendee']),
  owner: person('owner', ['organizer']),
  otherOrganizer: person('other-organizer', ['organizer']),
  admin: person('admin', ['admin']),
};
type Who = keyof typeof people;

const event = { organizerId: people.owner.id };

// SPEC section 4, one row per action. Each column is one role alone.
const TABLE: [Action, Record<Who, boolean>][] = [
  ['me:read', { attendee: true, owner: true, otherOrganizer: true, admin: true }],
  ['event:read', { attendee: true, owner: true, otherOrganizer: true, admin: true }],
  ['event:list-past', { attendee: false, owner: false, otherOrganizer: false, admin: true }],
  ['event:create', { attendee: false, owner: true, otherOrganizer: true, admin: false }],
  ['event:update', { attendee: false, owner: true, otherOrganizer: false, admin: false }],
  ['event:list-registrations', { attendee: false, owner: true, otherOrganizer: false, admin: true }],
  ['registration:self', { attendee: true, owner: false, otherOrganizer: false, admin: false }],
  ['registration:list-own', { attendee: true, owner: false, otherOrganizer: false, admin: false }],
  ['user:list', { attendee: false, owner: false, otherOrganizer: false, admin: true }],
];

describe('policy', () => {
  it('matches the permission table in SPEC section 4', () => {
    for (const [action, expected] of TABLE) {
      for (const who of Object.keys(people) as Who[]) {
        expect(can(people[who], action, event), `${who} -> ${action}`).toBe(expected[who]);
      }
    }
  });

  it('gives a person with two roles the rights of both', () => {
    const both = person('both', ['organizer', 'attendee']);
    expect(can(both, 'event:create')).toBe(true);
    expect(can(both, 'registration:self')).toBe(true);
  });

  it('denies owner-only actions when no event is given', () => {
    expect(can(people.owner, 'event:update')).toBe(false);
    expect(can(people.owner, 'event:list-registrations')).toBe(false);
  });

  it('fails loudly on an action it has no rule for', () => {
    expect(() => can(people.admin, 'event:delete' as Action)).toThrow(/no rule for action/);
  });
});
