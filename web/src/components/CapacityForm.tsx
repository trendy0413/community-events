import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Schemas } from '../api/client';
import { useChangeCapacity } from '../api/queries';
import { showProblem } from './notify';

/**
 * Anyone may try; the server allows only the event's organizer (R5) and
 * refuses a capacity below the seats taken (R7). The refusal is shown.
 */
export function CapacityForm({ event }: { event: Schemas['Event'] }) {
  const change = useChangeCapacity(event.id);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(submitted) => {
        submitted.preventDefault();
        const form = submitted.currentTarget;
        const value = new FormData(form).get('capacity');
        change.mutate(Number(typeof value === 'string' ? value : ''), {
          onSuccess: (updated) => toast.success(`Capacity is now ${updated.capacity}.`),
          onError: (error) => {
            showProblem(error, 'change-capacity');
            // Show the capacity the event still has, not the refused one.
            form.reset();
          },
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`capacity-${event.id}`}>Capacity</Label>
        <Input
          id={`capacity-${event.id}`}
          name="capacity"
          type="number"
          inputMode="numeric"
          defaultValue={event.capacity}
          key={event.capacity}
          className="w-28"
        />
      </div>
      <Button type="submit" variant="outline" disabled={change.isPending}>
        {change.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Change capacity
      </Button>
    </form>
  );
}
