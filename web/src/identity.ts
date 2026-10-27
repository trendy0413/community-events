import { useSyncExternalStore } from 'react';
import { type DemoPerson, findPerson, personas } from './demo/people';

// The person the visitor picked. It only sets the X-Dev-User-Id header on
// API calls (W2). Kept outside React, so the API client can read it too.

const STORAGE_KEY = 'community-events.person';
const listeners = new Set<() => void>();
let currentId: string | null = readStored();

function readStored(): string | null {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return personas.some((person) => person.id === id) ? id : null;
  } catch {
    // Storage can be blocked (private mode); the demo still works without it.
    return null;
  }
}

export function currentPersonId(): string | null {
  return currentId;
}

export function setCurrentPerson(id: string | null): void {
  currentId = id;
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See readStored.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCurrentPerson(): DemoPerson | null {
  return findPerson(useSyncExternalStore(subscribe, currentPersonId));
}
