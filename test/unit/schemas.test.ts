import { describe, expect, it } from 'vitest';
import { CreateEventBody, ListEventsQuery } from '../../src/modules/events/schemas.js';
import { MyRegistrationsQuery } from '../../src/modules/registrations/schemas.js';

describe('list queries', () => {
  it('cap every list at 20 rows unless limit says otherwise', () => {
    for (const schema of [ListEventsQuery, MyRegistrationsQuery]) {
      expect(schema.parse({}).limit).toBe(20);
      expect(schema.parse({ limit: '50' }).limit).toBe(50);
    }
  });
});

describe('create event body', () => {
  it('reports only the format error for a start that is not a date', () => {
    const result = CreateEventBody.safeParse({ title: 'Board games', startsAt: '', timezone: 'UTC', capacity: 5 });

    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['startsAt']);
  });
});
