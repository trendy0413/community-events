import seed from '../../../seed/personas.json';

// The demo's fake people (SPEC section 9, W5), read from the same seed file
// the server is seeded from, so the ids always match. What each person may
// do is decided by the server; the text here only describes it (W2).

export interface DemoPerson {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

interface Persona extends DemoPerson {
  /** One line on what to try as this person. */
  tryThis: string;
  /** Where "Continue as" leads. */
  startAt: string;
}

const GUIDE: Record<string, Pick<Persona, 'tryThis' | 'startAt'>> = {
  'olivia@example.com': {
    tryThis: 'Creates events, changes their capacity and sees who registered.',
    startAt: '/organizer',
  },
  'omar@example.com': { tryThis: "Another organizer. Try to change one of Olivia's events.", startAt: '/organizer' },
  'ana@example.com': { tryThis: 'Registers for events and cancels.', startAt: '/events' },
  'ben@example.com': { tryThis: 'Another attendee. Race Ana for the last seat.', startAt: '/events' },
  'ada@example.com': { tryThis: 'Sees every user and who registered. Changes nothing.', startAt: '/admin' },
};

export const personas: Persona[] = seed.people.map((person) => ({
  ...person,
  ...(GUIDE[person.email] ?? { tryThis: '', startAt: '/events' }),
}));

/** Owns the events that proof runs create. */
export const proofOrganizer: DemoPerson = seed.proofOrganizer;

/** The attendees a proof run sends at an event, all at once. */
export const crowd: DemoPerson[] = seed.crowd;

export function findPerson(id: string | null): DemoPerson | null {
  if (!id) return null;
  return [...seed.people, seed.proofOrganizer, ...seed.crowd].find((person) => person.id === id) ?? null;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
