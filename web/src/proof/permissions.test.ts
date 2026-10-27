import { describe, expect, it } from 'vitest';
import { CHECKS, COLUMNS, judge } from './permissions';
import { summarize } from './cancel';

describe('who can do what', () => {
  it('reads only 403 as denied', () => {
    expect(judge(403)).toBe('denied');
    for (const status of [200, 201, 204, 409]) expect(judge(status)).toBe('allowed');
    expect(judge(0)).toBe('no answer');
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
