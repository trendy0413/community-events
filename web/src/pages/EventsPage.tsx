import { useEvents } from '../api/queries';
import { EventCard } from '../components/EventCard';
import { CardsSkeleton, EmptyState, LoadProblem, PageTitle } from '../components/States';
import { proofOrganizer } from '../demo/people';

export function EventsPage() {
  const events = useEvents();

  // Proof runs are demo machinery, not events to browse; their own page links to them.
  const shown = events.data?.events.filter((event) => event.organizer.id !== proofOrganizer.id) ?? [];

  return (
    <>
      <PageTitle title="Upcoming events" />
      {events.isPending && <CardsSkeleton />}
      {events.isError && <LoadProblem error={events.error} action="load" />}
      {events.isSuccess &&
        (shown.length === 0 ? (
          <EmptyState title="No upcoming events">An organizer can create one.</EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((event) => (
              <li key={event.id}>
                <EventCard event={event} />
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}
