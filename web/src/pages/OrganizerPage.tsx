import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useEvents } from '../api/queries';
import { EventCard } from '../components/EventCard';
import { CardsSkeleton, EmptyState, LoadProblem, PageTitle } from '../components/States';
import { NewEventDialog } from './NewEventDialog';

export function OrganizerPage() {
  const events = useEvents({ organizer: 'me' });

  return (
    <>
      <PageTitle title="My events">
        <NewEventDialog />
      </PageTitle>
      {events.isPending && <CardsSkeleton count={2} />}
      {events.isError && <LoadProblem error={events.error} action="load" />}
      {events.isSuccess &&
        (events.data.events.length === 0 ? (
          <EmptyState title="No upcoming events of yours">
            Create one. If this person is not an organizer, the server will say so.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.data.events.map((event) => (
              <li key={event.id}>
                <EventCard
                  event={event}
                  footer={
                    <Button asChild variant="outline" className="w-full">
                      <Link to={`/events/${event.id}`}>Attendees and capacity</Link>
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}
