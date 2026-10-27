import { CalendarClock, MapPin, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { Schemas } from '../../api/client';
import { SeatBar } from '../../components/SeatBar';
import { eventStart } from '../../lib/format';

type OrderStatus = Schemas['Order']['status'];

const STATUS: Record<OrderStatus, { label: string; className: string }> = {
  booked: { label: 'Booked, waiting for a driver', className: 'bg-amber-100 text-amber-900' },
  claimed: { label: 'A driver has it', className: 'bg-indigo-100 text-indigo-800' },
  delivered: { label: 'Delivered', className: 'bg-success text-success-foreground' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

/** The order's status as the server reported it, in words. */
export function OrderStatusBadge({ status, driver }: { status: OrderStatus; driver?: { name: string } | null }) {
  const { label, className } = STATUS[status];
  return <Badge className={className}>{status === 'claimed' && driver ? `${driver.name} has it` : label}</Badge>;
}

export function SlotFacts({ slot }: { slot: Pick<Schemas['Slot'], 'startsAt' | 'timezone' | 'area' | 'supplier'> }) {
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p className="flex items-center gap-1.5">
        <CalendarClock className="size-4" aria-hidden="true" />
        {eventStart(slot.startsAt, slot.timezone)}
      </p>
      <p className="flex items-center gap-1.5">
        <MapPin className="size-4" aria-hidden="true" />
        {slot.area}
      </p>
      <p className="flex items-center gap-1.5">
        <Store className="size-4" aria-hidden="true" />
        {slot.supplier.name}
      </p>
    </div>
  );
}

export function SlotCard({ slot, footer }: { slot: Schemas['Slot']; footer?: React.ReactNode }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base leading-snug">{slot.title}</CardTitle>
        <SlotFacts slot={slot} />
      </CardHeader>
      <CardContent className="flex-1">
        <SeatBar
          unit="deliveries"
          registeredCount={slot.bookedCount}
          capacity={slot.capacity}
          seatsLeft={slot.deliveriesLeft}
        />
      </CardContent>
      {footer && <CardFooter className="gap-2">{footer}</CardFooter>}
    </Card>
  );
}
