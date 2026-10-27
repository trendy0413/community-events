import { CalendarClock, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { Schemas } from '../api/client';
import { eventStart } from '../lib/format';
import { RegistrationButton } from './RegistrationButton';
import { SeatBar } from './SeatBar';

export function EventCard({ event, footer }: { event: Schemas['Event']; footer?: React.ReactNode }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">
            <Link to={`/events/${event.id}`} className="underline-offset-4 hover:underline">
              {event.title}
            </Link>
          </CardTitle>
          {event.myRegistration && <Badge className="shrink-0 bg-success text-success-foreground">Registered</Badge>}
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <CalendarClock className="size-4" aria-hidden="true" />
            {eventStart(event.startsAt, event.timezone)}
          </p>
          <p className="flex items-center gap-1.5">
            <UserRound className="size-4" aria-hidden="true" />
            {event.organizer.name}
          </p>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <SeatBar registeredCount={event.registeredCount} capacity={event.capacity} seatsLeft={event.seatsLeft} />
      </CardContent>
      <CardFooter className="gap-2">{footer ?? <RegistrationButton event={event} className="w-full" />}</CardFooter>
    </Card>
  );
}
