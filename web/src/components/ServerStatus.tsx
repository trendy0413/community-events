import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHealth } from '../api/queries';

/** "Waking the server…" until /v1/health answers; the demo database sleeps when idle. */
export function ServerStatus({ className }: { className?: string }) {
  const health = useHealth();

  let label = 'Waking the server…';
  let tone = 'bg-muted text-muted-foreground';
  if (health.data?.db === 'ok') {
    label = 'Ready';
    tone = 'bg-success/10 text-success';
  } else if (health.isError && !health.isFetching) {
    label = 'Server not answering';
    tone = 'bg-destructive/10 text-destructive';
  }

  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', tone, className)}
    >
      {label === 'Waking the server…' ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}
