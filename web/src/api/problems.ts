import { ApiError } from './client';

// The server's answers in plain words, in one place. The text explains what
// the server decided (SPEC sections 4 and 7); it never decides anything (W1).

export type Action =
  | 'load'
  | 'register'
  | 'cancel'
  | 'create-event'
  | 'change-capacity'
  | 'see-attendees'
  | 'my-registrations'
  | 'see-users';

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
};

const STARTED: Partial<Record<Action, string>> = {
  register: 'This event has started, so registration is closed.',
  cancel: 'This event has started, so it is too late to cancel.',
  'change-capacity': 'This event has started, so its capacity can no longer change.',
};

const BY_CODE: Record<string, string> = {
  VALIDATION_FAILED: 'Some fields need a fix.',
  UNAUTHENTICATED: 'Pick a demo person first.',
  NOT_FOUND: 'This event does not exist.',
  EVENT_FULL: 'All seats are taken.',
  CAPACITY_BELOW_REGISTERED: 'More people are already registered than that.',
  INTERNAL_ERROR: 'The server had a problem. Please try again.',
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
  else if (code === 'EVENT_STARTED') title = STARTED[action] ?? 'This event has started.';
  else title = (code && BY_CODE[code]) ?? BY_STATUS[error.status] ?? 'Something went wrong.';

  return {
    title,
    detail: error.problem?.detail ?? null,
    answer: error.status === 0 ? 'no answer' : [error.status, code].filter(Boolean).join(' '),
  };
}

/** Field messages from a VALIDATION_FAILED answer, by field name. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.problem?.code !== 'VALIDATION_FAILED') return {};
  return Object.fromEntries((error.problem.errors ?? []).map((item) => [item.field, item.message]));
}
