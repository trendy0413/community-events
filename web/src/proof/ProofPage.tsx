import { useState } from 'react';
import { ExternalLink, Loader2, Play } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useHealth } from '../api/queries';
import { ProblemNotice } from '../components/ProblemNotice';
import { RACE_TESTS_URL, SEAT_SQL_URL, SPEC_URL } from '../links';
import { CancelPanel, PermissionsPanel } from './MorePanels';
import { DatabaseCheck, OutcomeTiles, TimingBars } from './RaceResults';
import { deps } from './deps';
import { PRESETS, type Race, readBack, type ReadBack, runRace, tally, timing, verdict } from './race';

type Step = 'idle' | 'running' | 'reading' | 'done' | 'failed';

export function ProofPage() {
  const [lastRace, setLastRace] = useState<Race | null>(null);
  return (
    <div className="space-y-8">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Try to overbook it</h1>
        <p className="text-muted-foreground">
          Every button hits the live server and a real database. Nothing is simulated.
        </p>
      </header>
      <RacePanel onFinished={setLastRace} />
      <CancelPanel race={lastRace} />
      <PermissionsPanel />
      <footer className="space-y-2 rounded-xl border bg-muted/40 p-4 text-sm">
        <p className="font-medium">This page shows that it works. The tests show why.</p>
        <p className="text-muted-foreground">
          The page reports outcomes only. The demo database has a small connection pool, so the server may queue some of
          these requests. The overlap itself is proven by the API tests, which run the same race with more database
          connections than requests.
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          <FooterLink href={RACE_TESTS_URL}>The race tests</FooterLink>
          <FooterLink href={SEAT_SQL_URL}>The SQL that keeps the last seat safe</FooterLink>
          <FooterLink href={SPEC_URL}>The rules (SPEC)</FooterLink>
        </ul>
      </footer>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <li>
      <a href={href} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
        {children} <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    </li>
  );
}

function RacePanel({ onFinished }: { onFinished: (race: Race) => void }) {
  const health = useHealth();
  const ready = health.data?.db === 'ok';
  const [presetId, setPresetId] = useState(PRESETS[0]?.id ?? '');
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const [step, setStep] = useState<Step>('idle');
  const [race, setRace] = useState<Race | null>(null);
  const [back, setBack] = useState<ReadBack | null>(null);
  const [error, setError] = useState<unknown>(null);

  const start = async () => {
    if (!preset) return;
    setStep('running');
    setRace(null);
    setBack(null);
    setError(null);
    try {
      const result = await runRace(deps, preset);
      setRace(result);
      setStep('reading');
      setBack(await readBack(deps, result.eventId));
      setStep('done');
      onFinished(result);
    } catch (failure) {
      setError(failure);
      setStep('failed');
    }
  };

  const busy = step === 'running' || step === 'reading';
  const counts = race ? tally(race.attempts) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{preset?.label ?? 'Race'}</CardTitle>
        <CardDescription>
          Creates a new event, then sends every registration at the same moment, each as a different person. Then it
          reads the database back.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            value={presetId}
            onValueChange={(value) => {
              if (value) setPresetId(value);
            }}
            aria-label="Race size"
            disabled={busy}
          >
            {PRESETS.map((option) => (
              <ToggleGroupItem key={option.id} value={option.id}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button size="lg" onClick={() => void start()} disabled={!ready || busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
            {busy ? 'Running…' : race ? 'Run again' : 'Send them all at once'}
          </Button>
          {!ready && <span className="text-sm text-muted-foreground">Waiting for the server to be ready…</span>}
        </div>

        <div aria-live="polite" className="space-y-6">
          {step === 'running' && <p className="text-sm text-muted-foreground">Creating the event and racing…</p>}
          {step === 'failed' && <ProblemNotice error={error} action="load" />}
          {race && counts && (
            <>
              <div className="space-y-1">
                <p className="text-lg font-medium">
                  Got a seat: <span className="text-success tabular-nums">{counts.seat}</span> · Told full:{' '}
                  <span className="text-destructive tabular-nums">{counts.full}</span> · Other errors:{' '}
                  <span className="tabular-nums">{counts.error}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {race.attempts.length} requests for {race.capacity} {race.capacity === 1 ? 'seat' : 'seats'} on the
                  new event{' '}
                  <Link className="text-primary underline-offset-4 hover:underline" to={`/events/${race.eventId}`}>
                    {race.title}
                  </Link>
                  .
                </p>
              </div>
              <OutcomeTiles attempts={race.attempts} />
              <TimingBars attempts={race.attempts} timing={timing(race.attempts)} protocol={protocolOf(race.eventId)} />
              {step === 'reading' && <p className="text-sm text-muted-foreground">Reading the database back…</p>}
              {back && (
                <DatabaseCheck
                  capacity={race.capacity}
                  readBack={back}
                  verdict={verdict(race.capacity, counts.seat, back)}
                />
              )}
              <RawResponses race={race} />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RawResponses({ race }: { race: Race }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm">
          Show raw responses
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs">
          {JSON.stringify(
            race.attempts.map((a) => ({ person: a.person.name, status: a.status, body: a.body })),
            null,
            2,
          )}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The protocol the browser reports for this race's calls (Resource Timing), or null. */
function protocolOf(eventId: string): string | null {
  const entry = performance
    .getEntriesByType('resource')
    .find((e): e is PerformanceResourceTiming => e.name.includes(eventId) && 'nextHopProtocol' in e);
  return entry?.nextHopProtocol || null;
}
