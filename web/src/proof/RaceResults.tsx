import { CircleCheck, CircleX, OctagonAlert, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Attempt, Outcome, ReadBack, Timing, Verdict } from './race';

const OUTCOME_STYLE: Record<Outcome, { label: string; tile: string; bar: string; Icon: typeof CircleCheck }> = {
  seat: { label: 'Seat', tile: 'border-success/40 bg-success/10 text-success', bar: 'bg-success', Icon: CircleCheck },
  full: {
    label: 'Full',
    tile: 'border-destructive/30 bg-destructive/10 text-destructive',
    bar: 'bg-destructive/70',
    Icon: CircleX,
  },
  error: {
    label: 'Error',
    tile: 'border-warning/50 bg-warning/15 text-warning-foreground',
    bar: 'bg-warning',
    Icon: TriangleAlert,
  },
};

/** One tile per person: who they were and what the server answered. */
export function OutcomeTiles({ attempts }: { attempts: Attempt[] }) {
  return (
    <ol className="grid grid-cols-5 gap-1.5 sm:grid-cols-10" aria-label="Answer for each person">
      {attempts.map((attempt) => {
        const style = OUTCOME_STYLE[attempt.outcome];
        return (
          <li
            key={attempt.person.id}
            className={cn(
              'flex flex-col items-center rounded-md border px-1 py-1.5 text-[0.7rem] leading-tight',
              style.tile,
            )}
            title={`${attempt.person.name}: ${attempt.status || 'no answer'}${attempt.code ? ` ${attempt.code}` : ''}`}
          >
            <style.Icon className="mb-0.5 size-3.5" aria-hidden="true" />
            <span className="font-semibold">{style.label}</span>
            <span className="opacity-80">{attempt.person.name.replace('Crowd ', 'C')}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** One bar per request, from the moment it was sent to its answer. */
export function TimingBars({
  attempts,
  timing,
  protocol,
}: {
  attempts: Attempt[];
  timing: Timing;
  /** The network protocol the browser used for these calls, if it reported one. */
  protocol: string | null;
}) {
  const start = Math.min(...attempts.map((a) => a.sentAt));
  const span = Math.max(timing.totalMs, 1);
  return (
    <figure className="space-y-2">
      <div className="space-y-px rounded-md border bg-muted/30 p-2" aria-hidden="true">
        {attempts.map((attempt) => (
          <div key={attempt.person.id} className="relative h-1">
            <div
              className={cn('absolute h-1 rounded-full', OUTCOME_STYLE[attempt.outcome].bar)}
              style={{
                left: `${((attempt.sentAt - start) / span) * 100}%`,
                width: `${Math.max(((attempt.doneAt - attempt.sentAt) / span) * 100, 0.5)}%`,
              }}
            />
          </div>
        ))}
      </div>
      <figcaption className="text-sm text-muted-foreground">
        All {attempts.length} sent within {Math.round(timing.spreadMs)} ms · at most {timing.peakInFlight} waiting for
        an answer at once · last answer after {(timing.totalMs / 1000).toFixed(1)} s.
        {timing.peakInFlight < attempts.length &&
          ` Your browser did not keep all ${attempts.length} open at the same moment, so some were sent after others had answered.`}
        {protocol === 'http/1.1' &&
          ' This connection uses HTTP/1.1, so the browser puts at most 6 of them on the network at a time and queues the rest.'}
      </figcaption>
    </figure>
  );
}

/** W4: the three numbers, each against the capacity, and the badge. */
export function DatabaseCheck({
  capacity,
  verdict,
  readBack,
}: {
  capacity: number;
  verdict: Verdict;
  readBack: ReadBack;
}) {
  return (
    <section aria-labelledby="db-check" className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="db-check" className="font-medium">
          Database check
        </h3>
        {verdict.noOverbooking ? (
          <Badge className="bg-success text-success-foreground">
            <CircleCheck aria-hidden="true" /> No overbooking
          </Badge>
        ) : (
          <Badge variant="destructive">
            <OctagonAlert aria-hidden="true" /> Numbers do not match the capacity
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Read back from the server after the race: the event and its attendee list. Capacity: {capacity}.
      </p>
      <dl className="grid gap-2 sm:grid-cols-3">
        {verdict.numbers.map((number) => (
          <div
            key={number.label}
            className={cn('rounded-lg border p-3', !number.matches && 'border-destructive/50 bg-destructive/5')}
          >
            <dt className="text-xs text-muted-foreground">{number.label}</dt>
            <dd className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{number.value}</span>
              <span className={cn('text-xs', number.matches ? 'text-success' : 'text-destructive')}>
                {number.matches ? `= capacity` : `capacity is ${capacity}`}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="sr-only">
        Event count {readBack.registeredCount}, attendee list {readBack.activeRows}.
      </p>
    </section>
  );
}
