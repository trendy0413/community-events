import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useEvents, useUsers } from '../api/queries';
import { PersonAvatar } from '../components/PersonAvatar';
import { ProblemNotice } from '../components/ProblemNotice';
import { EmptyState, PageTitle } from '../components/States';
import { eventStart } from '../lib/format';

/** Read-only, like the admin role in this build (SPEC section 2). Others get the server's 403. */
export function AdminPage() {
  const users = useUsers();
  const past = useEvents({ scope: 'past' });

  return (
    <div className="space-y-10">
      <PageTitle title="Admin overview" />
      <section aria-labelledby="users-heading" className="space-y-3">
        <h2 id="users-heading" className="text-lg font-semibold tracking-tight">
          Users
        </h2>
        {users.isPending && <Skeleton className="h-40 rounded-xl" />}
        {users.isError && <ProblemNotice error={users.error} action="see-users" />}
        {users.isSuccess && (
          <ul className="divide-y rounded-xl border">
            {users.data.users.map((user) => (
              <li key={user.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <PersonAvatar name={user.name} roles={user.roles} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{user.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
                <span className="flex gap-1">
                  {user.roles.map((role) => (
                    <Badge key={role} variant="secondary">
                      {role}
                    </Badge>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="past-heading" className="space-y-3">
        <h2 id="past-heading" className="text-lg font-semibold tracking-tight">
          Events that have started
        </h2>
        {past.isPending && <Skeleton className="h-24 rounded-xl" />}
        {past.isError && <ProblemNotice error={past.error} action="see-past" />}
        {past.isSuccess &&
          (past.data.events.length === 0 ? (
            <EmptyState title="None yet" />
          ) : (
            <ul className="divide-y rounded-xl border">
              {past.data.events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
                  <Link className="font-medium underline-offset-4 hover:underline" to={`/events/${event.id}`}>
                    {event.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {eventStart(event.startsAt, event.timezone)} · {event.registeredCount} of {event.capacity} taken
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
