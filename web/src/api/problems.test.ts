import { describe, expect, it } from 'vitest';
import { ApiError, type Problem } from './client';
import { explain, fieldErrors } from './problems';

const problem = (code: Problem['code'], extra: Partial<Problem> = {}): Problem => ({
  type: 'about:blank',
  title: 'x',
  status: 400,
  code,
  detail: 'Server detail.',
  ...extra,
});

describe('problems', () => {
  it('explains a refusal in words that fit the action, with the real answer', () => {
    const forbidden = new ApiError(403, problem('FORBIDDEN', { status: 403 }));

    expect(explain(forbidden, 'create-event')).toEqual({
      title: 'Only organizers can create events.',
      detail: 'Server detail.',
      answer: '403 FORBIDDEN',
    });
    expect(explain(forbidden, 'see-attendees').title).toBe(
      "Only the event's organizer and admins can see who registered.",
    );
    expect(explain(new ApiError(409, problem('EVENT_STARTED')), 'cancel').title).toBe(
      'This event has started, so it is too late to cancel.',
    );
  });

  it('explains answers that are not problem+json by their status', () => {
    expect(explain(new ApiError(429, null), 'register')).toMatchObject({ answer: '429', detail: null });
    expect(explain(new ApiError(0, null), 'load').answer).toBe('no answer');
  });

  it('keeps the first message for each field', () => {
    const error = new ApiError(
      400,
      problem('VALIDATION_FAILED', {
        errors: [
          { field: 'startsAt', message: 'Invalid date' },
          { field: 'startsAt', message: 'Must be in the future' },
          { field: 'capacity', message: 'Must be at least 1' },
        ],
      }),
    );

    expect(fieldErrors(error)).toEqual({ startsAt: 'Invalid date', capacity: 'Must be at least 1' });
    expect(fieldErrors(new ApiError(409, problem('EVENT_FULL')))).toEqual({});
  });
});
