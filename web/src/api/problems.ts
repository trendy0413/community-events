import { ApiError } from './client';

// The server's answers in plain words, in one place. The text explains what
// the server decided (SPEC sections 4, 7 and 14); it never decides anything (W1).

export type Action =
  | 'load'
  | 'register'
  | 'cancel'
  | 'create-event'
  | 'change-capacity'
  | 'see-attendees'
  | 'my-registrations'
  | 'see-users'
  | 'see-past'
  | 'create-slot'
  | 'see-slot-orders'
  | 'place-order'
  | 'cancel-order'
  | 'my-orders'
  | 'work-jobs';

export interface Explanation {
  /** Plain words for the visitor. */
  title: string;
  /** The server's own detail, when it sent one. */
  detail: string | null;
  /** For example "409 EVENT_FULL", so the real answer stays visible. */
  answer: string;
}

const FORBIDDEN: Record<Action, string> = {
  load: 'This person may not see this.',
  register: 'Only attendees can register.',
  cancel: 'Only attendees can cancel a registration.',
  'create-event': 'Only organizers can create events.',
  'change-capacity': "Only the event's organizer can change its capacity.",
  'see-attendees': "Only the event's organizer and admins can see who registered.",
  'my-registrations': 'Only attendees have registrations.',
  'see-users': 'Only admins can see all users.',
  'see-past': 'Only admins can list events that have started.',
  'create-slot': 'Only suppliers can publish delivery slots.',
  'see-slot-orders': "Only the slot's supplier and admins can see its orders.",
  'place-order': 'Only contractors can order deliveries.',
  'cancel-order': 'Only the contractor who placed an order can cancel it.',
  'my-orders': 'Only contractors have orders.',
  'work-jobs': 'Only drivers can take and deliver jobs, and only their own.',
};

const STARTED: Partial<Record<Action, string>> = {
  register: 'This event has started, so registration is closed.',
  cancel: 'This event has started, so it is too late to cancel.',
  'change-capacity': 'This event has started, so its capacity can no longer change.',
  'place-order': 'This delivery slot has started, so it takes no new orders.',
  'cancel-order': 'This delivery slot has started, so it is too late to cancel.',
};

const BY_CODE: Record<string, string> = {
  VALIDATION_FAILED: 'Some fields need a fix.',
  UNAUTHENTICATED: 'Pick a demo person first.',
  EVENT_FULL: 'All seats are taken.',
  CAPACITY_BELOW_REGISTERED: 'More people are already registered than that.',
  SLOT_FULL: 'No deliveries are left in this slot.',
  ORDER_ID_IN_USE:
    'An earlier send of this form was already placed as a different order. Check My orders, then try again.',
  ORDER_CLAIMED: 'A driver has already taken this delivery, so it can no longer be cancelled.',
  JOB_TAKEN: 'Another driver took this job first.',
  JOB_NOT_OPEN: 'This order was cancelled or delivered, so nobody can take it.',
  INTERNAL_ERROR: 'The server had a problem. Please try again.',
};

const NOT_FOUND: Partial<Record<Action, string>> = {
  register: 'This event does not exist.',
  cancel: 'This event does not exist.',
  'change-capacity': 'This event does not exist.',
  'see-attendees': 'This event does not exist.',
  'see-slot-orders': 'This delivery slot does not exist.',
  'place-order': 'This delivery slot does not exist.',
  'cancel-order': 'This order does not exist.',
  'work-jobs': 'This delivery job does not exist.',
};

const BY_STATUS: Record<number, string> = {
  0: 'The server could not be reached. Check your connection and try again.',
  429: 'Too many requests from your network. Wait a minute, then try again.',
  503: 'The database is not answering. Try again in a moment.',
};

export function explain(error: unknown, action: Action): Explanation {
  if (!(error instanceof ApiError)) {
    return { title: 'Something went wrong in the page.', detail: null, answer: 'no answer' };
  }
  const code = error.problem?.code ?? null;
  let title: string;
  if (code === 'FORBIDDEN') title = FORBIDDEN[action];
  else if (code === 'EVENT_STARTED' || code === 'SLOT_STARTED') title = STARTED[action] ?? 'It has started.';
  else if (code === 'NOT_FOUND') title = NOT_FOUND[action] ?? 'It does not exist.';
  else title = (code && BY_CODE[code]) ?? BY_STATUS[error.status] ?? 'Something went wrong.';

  // For a validation error, the first field and its reason say more than
  // "The request has invalid fields".
  const firstField = error.problem?.errors?.[0];
  return {
    title,
    detail: firstField ? `${firstField.field}: ${firstField.message}` : (error.problem?.detail ?? null),
    answer: error.status === 0 ? 'no answer' : [error.status, code].filter(Boolean).join(' '),
  };
}

/** Field messages from a VALIDATION_FAILED answer, by field name: the first message for each field. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.problem?.code !== 'VALIDATION_FAILED') return {};
  const byField: Record<string, string> = {};
  for (const item of error.problem.errors ?? []) byField[item.field] ??= item.message;
  return byField;
}
