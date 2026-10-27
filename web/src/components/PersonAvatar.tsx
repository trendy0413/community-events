import { cn } from '@/lib/utils';
import { initials } from '../demo/people';

// A fixed color per role, so a person looks the same everywhere.
const ROLE_COLORS: Record<string, string> = {
  organizer: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  attendee: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  admin: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
};

export function PersonAvatar({ name, roles, className }: { name: string; roles: string[]; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        ROLE_COLORS[roles[0] ?? ''] ?? 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
