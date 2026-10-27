import type { Db } from '../../db/client.js';
import type { Role } from '../../db/schema.js';

export interface User {
  id: string;
  name: string;
  email: string;
  roles: Role[];
}

/** Everyone, with emails (R6: admins only; checked by the route). The id breaks name ties, so the order is stable. */
export async function listUsers(db: Db): Promise<User[]> {
  return db.selectFrom('users').select(['id', 'name', 'email', 'roles']).orderBy('name').orderBy('id').execute();
}
