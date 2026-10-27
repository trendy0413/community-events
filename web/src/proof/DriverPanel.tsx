import { useState } from 'react';
import { CircleCheck, CircleX, Loader2, OctagonAlert, Play, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { api } from '../api/client';
import { useHealth } from '../api/queries';
import { ProblemNotice } from '../components/ProblemNotice';
import { supplyProof } from '../demo/people';
import { type ClaimOutcome, type DriverRace, exactlyOneDriver, runDriverRace } from './drivers';

const STYLE: Record<ClaimOutcome, { label: string; tile: string; Icon: typeof CircleCheck }> = {
  got: { label: 'Got it', tile: 'border-success/40 bg-success/10 text-success', Icon: CircleCheck },
  taken: { label: 'Taken', tile: 'border-destructive/30 bg-destructive/10 text-destructive', Icon: CircleX },
  error: { label: 'Error', tile: 'border-warning/50 bg-warning/15 text-warning-foreground', Icon: TriangleAlert },
};

/** Panel 4: one delivery job, every proof driver taps "Take this job" at once (SPEC S4). */
export function DriverPanel() {
  const [race, setRace] = useState<DriverRace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ready = useHealth().data?.db === 'ok';

  const start = async () => {
    setBusy(true);
    setRace(null);
    setError(null);
    try {
      setRace(await runDriverRace({ api, ...supplyProof, today: () => new Date(), newId: () => crypto.randomUUID() }));
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const fair = race ? exactlyOneDriver(race) : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">One job, {supplyProof.drivers.length} drivers</CardTitle>
        <CardDescription>
          A contractor orders one delivery. Then {supplyProof.drivers.length} drivers try to take the job at the same
          moment. Exactly one should get it; the order is then read back to see whose it is.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={() => void start()} disabled={!ready || busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
          {busy ? 'Running…' : race ? 'Run again' : 'Send all drivers at once'}
        </Button>
        <div aria-live="polite" className="space-y-4">
          {busy && (
            <p className="text-sm text-muted-foreground">Publishing a slot, ordering, and sending the drivers…</p>
          )}
          {error !== null && <ProblemNotice error={error} action="load" />}
          {race && (
            <div className="space-y-4">
              <ol className="grid grid-cols-5 gap-1.5" aria-label="Answer for each driver">
                {race.claims.map((claim) => {
                  const style = STYLE[claim.outcome];
                  return (
                    <li
                      key={claim.driver.id}
                      className={cn(
                        'flex flex-col items-center rounded-md border px-1 py-1.5 text-[0.7rem]',
                        style.tile,
                      )}
                      title={`${claim.driver.name}: ${claim.status || 'no answer'}${claim.code ? ` ${claim.code}` : ''}`}
                    >
                      <style.Icon className="mb-0.5 size-3.5" aria-hidden="true" />
                      <span className="font-semibold">{style.label}</span>
                      <span className="opacity-80">{claim.driver.name.replace('Driver ', 'D')}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="flex flex-wrap items-center gap-3">
                {fair ? (
                  <Badge className="bg-success text-success-foreground">
                    <CircleCheck aria-hidden="true" /> Exactly one driver
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <OctagonAlert aria-hidden="true" /> Not exactly one driver
                  </Badge>
                )}
                <span className="text-sm text-muted-foreground">
                  Read back from the server: the order belongs to {race.readBack?.driver?.name ?? 'nobody'} (
                  {race.readBack?.status ?? 'not found'}).
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
