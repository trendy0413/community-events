import type { Role } from '../db/schema.js';
import { DomainError } from '../http/errors.js';

// Who may do what (SPEC section 4). Every /v1 route except /v1/health calls
// authorize() with one of these actions before it reads or changes anything
// the actor may not see. Owner checks first read the event's owner from the
// database, never from the request.

export interface Actor {
  id: string;
  name: string;
  email: string;
  roles: Role[];
}

export type Action =
  | 'event:read'
  | 'event:list-all'
  | 'event:create'
  | 'event:update'
  | 'event:list-registrations'
  | 'registration:self'
  | 'registration:list-own'
  | 'user:list';

/** The event an action is about, when the answer depends on who owns it. */
export interface OwnedResource {
  organizerId: string;
}

export function can(actor: Actor, action: Action, resource?: OwnedResource): boolean {
  const has = (role: Role) => actor.roles.includes(role);
  const owns = resource !== undefined && resource.organizerId === actor.id;

  switch (action) {
    case 'event:read':
      return true;
    case 'event:list-all':
      return has('admin');
    case 'event:create':
      return has('organizer');
    case 'event:update':
      return has('organizer') && owns;
    case 'event:list-registrations':
      return has('admin') || (has('organizer') && owns);
    case 'registration:self':
    case 'registration:list-own':
      return has('attendee');
    case 'user:list':
      return has('admin');
    default:
      // An action added to the type but not to this switch is a compile
      // error here; at runtime it fails the request instead of allowing it.
      throw new Error(`can(): no rule for action ${String(action)}`);
  }
}

export function authorize(actor: Actor, action: Action, resource?: OwnedResource): void {
  if (!can(actor, action, resource)) {
    throw new DomainError('FORBIDDEN', 'You are not allowed to do this.');
  }
}
