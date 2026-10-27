import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { explain, fieldErrors } from '../api/problems';
import { useCreateEvent } from '../api/queries';
import { ProblemNotice } from '../components/ProblemNotice';

// The visitor's own time zone. The form sends the start with its offset and
// this zone's name; the server checks both (R10).
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const FIELDS = ['title', 'description', 'startsAt', 'timezone', 'capacity'];

/**
 * The form checks nothing itself (W1): no required fields, no limits. The
 * server validates, and its field errors show next to the fields.
 */
export function NewEventDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateEvent();
  const navigate = useNavigate();
  const errors = fieldErrors(create.error);
  const otherErrors = Object.entries(errors).filter(([field]) => !FIELDS.includes(field));
  const failedOtherwise = create.isError && Object.keys(errors).length === 0;

  const submit = (form: FormData) => {
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value : '';
    };
    const local = text('startsAt');
    create.mutate(
      {
        title: text('title'),
        description: text('description'),
        // datetime-local has no offset; the browser reads it in TIME_ZONE.
        startsAt: local ? new Date(local).toISOString() : '',
        timezone: TIME_ZONE,
        capacity: Number(text('capacity')),
      },
      {
        onSuccess: (event) => {
          toast.success(`Created ${event.title}.`);
          setOpen(false);
          create.reset();
          void navigate(`/events/${event.id}`);
        },
        onError: (error) => {
          if (Object.keys(fieldErrors(error)).length === 0) toast.error(explain(error, 'create-event').title);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) create.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" /> New event
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
          <DialogDescription>The server checks every field and explains what to fix.</DialogDescription>
        </DialogHeader>
        <form
          id="new-event"
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit(new FormData(event.currentTarget));
          }}
        >
          <Field name="title" label="Title" error={errors.title}>
            <Input id="title" name="title" autoComplete="off" aria-invalid={Boolean(errors.title)} />
          </Field>
          <Field name="description" label="Description (optional)" error={errors.description}>
            <Textarea id="description" name="description" rows={3} aria-invalid={Boolean(errors.description)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="startsAt"
              label="Starts"
              hint={`Your time zone: ${TIME_ZONE}`}
              error={errors.startsAt ?? errors.timezone}
            >
              <Input id="startsAt" name="startsAt" type="datetime-local" aria-invalid={Boolean(errors.startsAt)} />
            </Field>
            <Field name="capacity" label="Capacity" error={errors.capacity}>
              <Input
                id="capacity"
                name="capacity"
                type="number"
                inputMode="numeric"
                aria-invalid={Boolean(errors.capacity)}
              />
            </Field>
          </div>
          {otherErrors.length > 0 && (
            <ul className="text-sm text-destructive">
              {otherErrors.map(([field, message]) => (
                <li key={field}>
                  {field}: {message}
                </li>
              ))}
            </ul>
          )}
          {failedOtherwise && <ProblemNotice error={create.error} action="create-event" />}
        </form>
        <DialogFooter>
          <Button type="submit" form="new-event" disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Create event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
