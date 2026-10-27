import { cn } from '@/lib/utils';

/**
 * "7 of 10 taken", from the counts the server returned. The bar only draws
 * them; "Full" comes from the server's seatsLeft (W1).
 */
export function SeatBar({
  registeredCount,
  capacity,
  seatsLeft,
  className,
}: {
  registeredCount: number;
  capacity: number;
  seatsLeft: number;
  className?: string;
}) {
  const full = seatsLeft === 0;
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium tabular-nums">
          {registeredCount} of {capacity} taken
        </span>
        <span className={cn('text-xs', full ? 'font-medium text-destructive' : 'text-muted-foreground')}>
          {full ? 'Full' : `${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} left`}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${registeredCount} of ${capacity} seats taken`}
      >
        <div
          className={cn('h-full rounded-full transition-[width]', full ? 'bg-destructive/70' : 'bg-primary')}
          style={{ width: `${capacity > 0 ? (registeredCount / capacity) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}
