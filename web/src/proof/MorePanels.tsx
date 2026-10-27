import { useState } from 'react';
import { CircleCheck, CircleX, Loader2, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ProblemNotice } from '../components/ProblemNotice';
import { personas } from '../demo/people';
import { type CancelStep, cancelOnce, retryFull } from './cancel';
import { deps } from './deps';
import { type Cell, CHECKS, type Column, COLUMNS, runChecks } from './permissions';
import type { Race } from './race';

/** Panel 2: cancel frees a seat, a second cancel frees nothing, and one waiting person gets it. */
export function CancelPanel({ race }: { race: Race | null }) {
  const [steps, setSteps] = useState<CancelStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [usedRace, setUsedRace] = useState<string | null>(null);

  const holder = race?.attempts.find((a) => a.outcome === 'seat')?.person;
  const told = race?.attempts.filter((a) => a.outcome === 'full').map((a) => a.person) ?? [];
  const canRun = race !== null && holder !== undefined && told.length > 0 && usedRace !== race.eventId;

  const start = async () => {
    if (!race || !holder) return;
    setBusy(true);
    setSteps([]);
    setError(null);
    setUsedRace(race.eventId);
    try {
      const first = await cancelOnce(deps, race.eventId, holder);
      setSteps([first]);
      const second = await cancelOnce(deps, race.eventId, holder);
      setSteps([first, { ...second, label: `${holder.name} cancels again` }]);
      const retry = await retryFull(deps, race.eventId, told);
      setSteps([first, { ...second, label: `${holder.name} cancels again` }, retry]);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Cancel frees a seat</CardTitle>
        <CardDescription>
          On the event of the last race: one person cancels, then cancels again, then everyone who was told "full" tries
          again at the same moment. Exactly one of them should get the freed seat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={() => void start()} disabled={!canRun || busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
          Cancel one seat, then race for it
        </Button>
        {!race && <p className="text-sm text-muted-foreground">Run a race above first.</p>}
        <ol aria-live="polite" className="space-y-2">
          {steps.map((step, index) => (
            <li key={step.label} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-3">
              <span className="text-sm">
                <span className="mr-2 text-muted-foreground">{index + 1}.</span>
                {step.label}
              </span>
              <span className="text-sm">
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{step.answers}</code>
                <span className="ml-3 font-medium tabular-nums">
                  {step.countAfter} of {race?.capacity} taken
                </span>
              </span>
            </li>
          ))}
        </ol>
        {steps.length === 3 && race && (
          <p className="text-sm text-muted-foreground">
            The count went down once, not twice, and back up by exactly one: the seat went to one person.
          </p>
        )}
        {error !== null && <ProblemNotice error={error} action="load" />}
      </CardContent>
    </Card>
  );
}

function personByEmail(email: string) {
  const person = personas.find((p) => p.email === email);
  if (!person) throw new Error(`seed file has no ${email}`);
  return person;
}

/** Panel 3: five actions by four people, each compared with the answer the SPEC expects. */
export function PermissionsPanel() {
  const [cells, setCells] = useState<Record<string, Record<Column, Cell>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await runChecks(deps, {
        owner: deps.organizer,
        otherOrganizer: personByEmail('omar@example.com'),
        attendee: personByEmail('ana@example.com'),
        admin: personByEmail('ada@example.com'),
      });
      setCells(result.cells);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const all = cells ? CHECKS.flatMap((check) => COLUMNS.map(({ id }) => cells[check.id]?.[id])) : [];
  const mismatches = all.filter((cell) => cell && !cell.matches).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Who can do what</CardTitle>
        <CardDescription>
          Twenty live calls. The expected answers are written in this page from the SPEC, not read from the server, so
          the comparison is not circular.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void start()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
            Check all twenty
          </Button>
          {cells && (
            <Badge
              aria-live="polite"
              className={mismatches === 0 ? 'bg-success text-success-foreground' : ''}
              variant={mismatches === 0 ? 'default' : 'destructive'}
            >
              {mismatches === 0 ? 'All 20 match the SPEC' : `${mismatches} do not match the SPEC`}
            </Badge>
          )}
        </div>
        {error !== null && <ProblemNotice error={error} action="load" />}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Action</th>
                {COLUMNS.map((column) => (
                  <th key={column.id} className="px-2 py-2 font-medium">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {CHECKS.map((check) => (
                <tr key={check.id}>
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {check.label} <span className="text-xs text-muted-foreground">({check.rule})</span>
                  </th>
                  {COLUMNS.map(({ id }) => (
                    <td key={id} className="px-2 py-2">
                      <CellView expected={check.expected[id]} cell={cells?.[check.id]?.[id]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function CellView({ expected, cell }: { expected: string; cell: Cell | undefined }) {
  if (!cell) return <span className="text-xs text-muted-foreground">expect {expected}</span>;
  const Icon = cell.actual === 'allowed' ? CircleCheck : CircleX;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs',
        cell.matches ? 'text-foreground' : 'bg-destructive/10 font-medium text-destructive',
      )}
    >
      <Icon
        className={cn('size-3.5', cell.actual === 'allowed' ? 'text-success' : 'text-muted-foreground')}
        aria-hidden="true"
      />
      {cell.actual === 'allowed' ? 'Allowed' : cell.actual === 'denied' ? 'Denied' : 'No answer'} · {cell.status || '—'}
      {!cell.matches && ` (expected ${expected})`}
    </span>
  );
}
