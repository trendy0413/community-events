import { Loader2 } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Schemas } from '../api/client';
import { useCancel, useMyRegistrations } from '../api/queries';
import { showProblem } from '../components/notify';
import { EmptyState, LoadProblem, PageTitle } from '../components/States';
import { eventStart, moment } from '../lib/format';

type MyRegistration = Schemas['MyRegistrations']['registrations'][number];

export function MyRegistrationsPage() {
  const registrations = useMyRegistrations();

  return (
    <>
      <PageTitle title="My registrations" />
      {registrations.isPending && <Skeleton className="h-40 rounded-xl" />}
      {registrations.isError && <LoadProblem error={registrations.error} action="my-registrations" />}
      {registrations.isSuccess &&
        (registrations.data.registrations.length === 0 ? (
          <EmptyState title="No registrations yet">
            <Link className="text-primary underline-offset-4 hover:underline" to="/events">
              Find an event
            </Link>
          </EmptyState>
        ) : (
          <ul className="divide-y rounded-xl border">
            {registrations.data.registrations.map((registration) => (
              <Row key={registration.id} registration={registration} />
            ))}
          </ul>
        ))}
    </>
  );
}

function Row({ registration }: { registration: MyRegistration }) {
  const cancel = useCancel(registration.event.id);
  const active = registration.status === 'active';
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link className="font-medium underline-offset-4 hover:underline" to={`/events/${registration.event.id}`}>
            {registration.event.title}
          </Link>
          {active ? (
            <Badge className="bg-success text-success-foreground">Active</Badge>
          ) : (
            <Badge variant="secondary">Cancelled</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {eventStart(registration.event.startsAt, registration.event.timezone)}
        </p>
        <p className="text-xs text-muted-foreground">
          Registered {moment(registration.createdAt)}
          {registration.cancelledAt && ` · cancelled ${moment(registration.cancelledAt)}`}
        </p>
      </div>
      {active && (
        <Button
          variant="outline"
          disabled={cancel.isPending}
          onClick={() => {
            cancel.mutate(undefined, {
              onSuccess: () => toast.success('Cancelled. Your seat is free for someone else.'),
              onError: (error) => {
                showProblem(error, 'cancel');
              },
            });
          }}
        >
          {cancel.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Cancel
        </Button>
      )}
    </li>
  );
}
