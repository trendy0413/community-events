import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Schemas } from '../../api/client';
import { useClaimJob, useJobs, useMarkDelivered } from '../../api/queries';
import { showProblem } from '../../components/notify';
import { EmptyState, LoadProblem } from '../../components/States';
import { supplyProof } from '../../demo/people';
import { OrderStatusBadge, SlotFacts } from './parts';

export function JobsPage() {
  const jobs = useJobs();
  // Proof runs are demo machinery; the proof page shows its own.
  const notProof = (job: Schemas['Job']) => job.slot.supplier.id !== supplyProof.supplier.id;

  return (
    <>
      {jobs.isPending && <Skeleton className="h-48 rounded-xl" />}
      {jobs.isError && <LoadProblem error={jobs.error} action="work-jobs" />}
      {jobs.isSuccess && (
        <div className="space-y-8">
          <JobList
            title="Open jobs"
            empty="No open jobs right now."
            jobs={jobs.data.open.filter(notProof)}
            action={(job) => <ClaimButton job={job} />}
          />
          <JobList
            title="My jobs"
            empty="You have not taken a job yet."
            jobs={jobs.data.mine.filter(notProof)}
            action={(job) => (job.status === 'claimed' ? <DeliveredButton job={job} /> : null)}
          />
        </div>
      )}
    </>
  );
}

function JobList({
  title,
  empty,
  jobs,
  action,
}: {
  title: string;
  empty: string;
  jobs: Schemas['Job'][];
  action: (job: Schemas['Job']) => React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {jobs.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {jobs.map((job) => {
            const footer = action(job);
            return (
              <li key={job.id}>
                <Card className="h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-snug">{job.items}</CardTitle>
                      <OrderStatusBadge status={job.status} driver={job.driver} />
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2">
                    <p className="text-sm font-medium">To {job.jobsite}</p>
                    <SlotFacts slot={job.slot} />
                  </CardContent>
                  {footer && <CardFooter>{footer}</CardFooter>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ClaimButton({ job }: { job: Schemas['Job'] }) {
  const claim = useClaimJob(job.id);
  return (
    <Button
      className="w-full"
      disabled={claim.isPending}
      onClick={() => {
        claim.mutate(undefined, {
          onSuccess: () => toast.success('The job is yours.'),
          onError: (error) => {
            showProblem(error, 'work-jobs');
          },
        });
      }}
    >
      {claim.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
      Take this job
    </Button>
  );
}

function DeliveredButton({ job }: { job: Schemas['Job'] }) {
  const deliver = useMarkDelivered(job.id);
  return (
    <Button
      variant="outline"
      className="w-full"
      disabled={deliver.isPending}
      onClick={() => {
        deliver.mutate(undefined, {
          onSuccess: () => toast.success('Marked delivered.'),
          onError: (error) => {
            showProblem(error, 'work-jobs');
          },
        });
      }}
    >
      {deliver.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
      Mark delivered
    </Button>
  );
}
