import { describe, expect, it } from 'vitest';
import { ListEventsQuery } from '../../src/modules/events/schemas.js';
import { MyRegistrationsQuery } from '../../src/modules/registrations/schemas.js';

describe('list queries', () => {
  it('cap every list at 20 rows unless limit says otherwise', () => {
    for (const schema of [ListEventsQuery, MyRegistrationsQuery]) {
      expect(schema.parse({}).limit).toBe(20);
      expect(schema.parse({ limit: '50' }).limit).toBe(50);
    }
  });
});
