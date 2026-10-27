import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { Schemas } from '../api/client';
import { useCancel, useRegister } from '../api/queries';
import { showProblem } from './notify';

/**
 * Register, or cancel when the server says this person holds a seat. The
 * button is never disabled by a rule: a full or started event is the
 * server's to refuse, and the refusal is shown (W1).
 */
export function RegistrationButton({ event, className }: { event: Schemas['Event']; className?: string }) {
  const register = useRegister(event.id);
  const cancel = useCancel(event.id);
  const busy = register.isPending || cancel.isPending;

  if (event.myRegistration) {
    return (
      <Button
        variant="outline"
        className={className}
        disabled={busy}
        onClick={() => {
          cancel.mutate(undefined, {
            onSuccess: () => toast.success('Cancelled. Your seat is free for someone else.'),
            onError: (error) => {
              showProblem(error, 'cancel');
            },
          });
        }}
      >
        {cancel.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Cancel registration
      </Button>
    );
  }
  return (
    <Button
      className={className}
      disabled={busy}
      onClick={() => {
        register.mutate(undefined, {
          onSuccess: () => toast.success(`You're registered for ${event.title}.`),
          onError: (error) => {
            showProblem(error, 'register');
          },
        });
      }}
    >
      {register.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
      Register
    </Button>
  );
}
