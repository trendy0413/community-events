import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '../api/client';
import type { Action } from '../api/problems';
import { useSwitchPerson } from '../api/queries';
import { personas } from '../demo/people';
import { PersonAvatar } from './PersonAvatar';
import { ProblemNotice } from './ProblemNotice';

export function CardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-52 rounded-xl" />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** A failed load. When nobody is picked, the server's 401 comes with a way to pick someone. */
export function LoadProblem({ error, action }: { error: unknown; action: Action }) {
  const switchPerson = useSwitchPerson();
  const nobody = error instanceof ApiError && error.status === 401;
  return (
    <div className="space-y-4">
      <ProblemNotice error={error} action={action} />
      {nobody && (
        <div className="flex flex-wrap gap-2">
          {personas.map((person) => (
            <Button
              key={person.id}
              variant="outline"
              onClick={() => {
                switchPerson(person.id);
              }}
            >
              <PersonAvatar name={person.name} roles={person.roles} className="size-5 text-[0.6rem]" />
              {person.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {children}
    </div>
  );
}
