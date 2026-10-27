import { ArrowLeft, CalendarClock, Globe, UserRound } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAttendees, useEvent } from '../api/queries';
import { CapacityForm } from '../components/CapacityForm';
import { ProblemNotice } from '../components/ProblemNotice';
import { RegistrationButton } from '../components/RegistrationButton';
import { SeatBar } from '../components/SeatBar';
import { EmptyState, LoadProblem } from '../components/States';
import { eventStart, moment } from '../lib/format';

export function EventPage() {
  const { id = '' } = useParams();
  const event = useEvent(id);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/events">
          <ArrowLeft aria-hidden="true" /> All events
        </Link>
      </Button>
      {event.isPending && <Skeleton className="h-64 rounded-xl" />}
      {event.isError && <LoadProblem error={event.error} action="load" />}
      {event.isSuccess && (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle className="text-2xl">{event.data.title}</CardTitle>
                {event.data.myRegistration && (
                  <Badge className="bg-success text-success-foreground">You're registered</Badge>
                )}
              </div>
              {event.data.description && (
                <CardDescription className="text-base">{event.data.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <Fact icon={<CalendarClock />} label="Starts">
                  {eventStart(event.data.startsAt, event.data.timezone)}
                </Fact>
                <Fact icon={<Globe />} label="Time zone">
                  {event.data.timezone}
                </Fact>
                <Fact icon={<UserRound />} label="Organizer">
                  {event.data.organizer.name}
                </Fact>
              </dl>
              <SeatBar
                registeredCount={event.data.registeredCount}
                capacity={event.data.capacity}
                seatsLeft={event.data.seatsLeft}
              />
              <RegistrationButton event={event.data} className="w-full sm:w-auto" />
              <div className="border-t pt-4">
                <CapacityForm event={event.data} />
              </div>
            </CardContent>
          </Card>
          <Attendees eventId={id} />
        </>
      )}
    </div>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

/** Who registered. Everyone may ask; the server answers only the organizer and admins (R6). */
export function Attendees({ eventId }: { eventId: string }) {
  const attendees = useAttendees(eventId);
  return (
    <section aria-labelledby="attendees-heading" className="space-y-3">
      <h2 id="attendees-heading" className="text-lg font-semibold tracking-tight">
        Who registered
      </h2>
      {attendees.isPending && <Skeleton className="h-24 rounded-xl" />}
      {attendees.isError && <ProblemNotice error={attendees.error} action="see-attendees" />}
      {attendees.isSuccess &&
        (attendees.data.registrations.length === 0 ? (
          <EmptyState title="Nobody yet" />
        ) : (
          <ol className="divide-y rounded-xl border">
            {attendees.data.registrations.map((row, index) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span>
                  <span className="mr-2 text-muted-foreground tabular-nums">{index + 1}.</span>
                  {row.attendee.name}
                </span>
                <span className="text-xs text-muted-foreground">{moment(row.registeredAt)}</span>
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}
