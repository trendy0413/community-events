import { describe, expect, it } from 'vitest';
import { CHECKS, COLUMNS, judge } from './permissions';
import { summarize } from './cancel';

describe('who can do what', () => {
  it('reads 2xx as allowed, 403 as denied, and anything else as neither', () => {
    expect(judge(403)).toBe('denied');
    for (const status of [200, 201, 204]) expect(judge(status)).toBe('allowed');
    for (const status of [0, 401, 404, 409, 500]) expect(judge(status)).toBe('unexpected');
  });

  it('writes an expected answer for every action and person', () => {
    expect(CHECKS).toHaveLength(5);
    for (const check of CHECKS) {
      expect(Object.keys(check.expected).sort()).toEqual(COLUMNS.map((c) => c.id).sort());
    }
  });
});

describe('cancel panel', () => {
  it('summarizes answers by status', () => {
    expect(summarize([409, 201, 409, 409])).toBe('201 × 1, 409 × 3');
    expect(summarize([204])).toBe('204 × 1');
    expect(summarize([0])).toBe('no answer × 1');
  });
});
