import { api } from '../api/client';
import { crowd, proofOrganizer } from '../demo/people';
import type { RaceDeps } from './race';

/** The proof page's calls go to the live API, as the proof organizer and the crowd. */
export const deps: RaceDeps = {
  api,
  organizer: proofOrganizer,
  crowd,
  now: () => performance.now(),
  today: () => new Date(),
};
