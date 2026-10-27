import type { Role } from '../db/schema.js';
import { DomainError } from '../http/errors.js';

// Who may do what (SPEC section 4, and section 14 for the supply flow). Every
// /v1 route except /v1/health calls authorize() with one of these actions
// before it reads or changes anything the actor may not see. Owner checks
// first read the owner from the database, never from the request.

export interface Actor {
  id: string;
  name: string;
  email: string;
  roles: Role[];
}

export type Action =
  | 'me:read'
  | 'event:read'
  | 'event:list-past'
  | 'event:create'
  | 'event:update'
  | 'event:list-registrations'
  | 'registration:self'
  | 'registration:list-own'
  | 'user:list'
  | 'slot:read'
  | 'slot:create'
  | 'slot:list-orders'
  | 'order:own'
  | 'job:work';

/** The event or slot an action is about, when the answer depends on who owns it. */
export interface OwnedResource {
  /** The event's organizer, or the slot's supplier. */
  ownerId: string;
}

export function can(actor: Actor, action: Action, resource?: OwnedResource): boolean {
  const has = (role: Role) => actor.roles.includes(role);
  const owns = resource !== undefined && resource.ownerId === actor.id;

  switch (action) {
    case 'me:read':
    case 'event:read':
      return true;
    case 'event:list-past':
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
    case 'slot:read':
      return true;
    case 'slot:create':
      return has('supplier');
    case 'slot:list-orders':
      return has('admin') || (has('supplier') && owns);
    case 'order:own':
      return has('contractor');
    case 'job:work':
      return has('driver');
    default: {
      // An action added to the type but not to this switch is a compile
      // error here; at runtime it fails the request instead of allowing it.
      const unhandled: never = action;
      throw new Error(`can(): no rule for action ${String(unhandled)}`);
    }
  }
}

export function authorize(actor: Actor, action: Action, resource?: OwnedResource): void {
  if (!can(actor, action, resource)) {
    throw new DomainError('FORBIDDEN', 'You are not allowed to do this.');
  }
}
