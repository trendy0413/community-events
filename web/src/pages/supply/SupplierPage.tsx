import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { explain, fieldErrors } from '../../api/problems';
import { useCreateSlot, useSlotOrders, useSlots } from '../../api/queries';
import { ProblemNotice } from '../../components/ProblemNotice';
import { CardsSkeleton, EmptyState, LoadProblem } from '../../components/States';
import { OrderStatusBadge, SlotCard } from './parts';

export function SupplierPage() {
  const slots = useSlots({ supplier: 'me' });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">My delivery slots</h2>
        <NewSlotDialog />
      </div>
      {slots.isPending && <CardsSkeleton count={2} />}
      {slots.isError && <LoadProblem error={slots.error} action="load" />}
      {slots.isSuccess &&
        (slots.data.slots.length === 0 ? (
          <EmptyState title="No upcoming slots of yours">
            Publish one. If this person is not a supplier, the server will say so.
          </EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {slots.data.slots.map((slot) => (
              <li key={slot.id}>
                <SlotCard slot={slot} footer={<SlotOrders slotId={slot.id} />} />
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/** A slot's orders, asked for when opened. Only the slot's supplier and admins get them (S6). */
function SlotOrders({ slotId }: { slotId: string }) {
  const [open, setOpen] = useState(false);
  const orders = useSlotOrders(slotId, open);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full">
          {open ? 'Hide orders' : 'Show orders'}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-2">
        {orders.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {orders.isError && <ProblemNotice error={orders.error} action="see-slot-orders" />}
        {orders.isSuccess &&
          (orders.data.orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {orders.data.orders.map((order) => (
                <li key={order.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{order.contractor.name}</span>
                    <OrderStatusBadge status={order.status} driver={order.driver} />
                  </div>
                  <p>{order.items}</p>
                  <p className="text-xs text-muted-foreground">To {order.jobsite}</p>
                </li>
              ))}
            </ul>
          ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// The visitor's own time zone, sent with the start, as for new events.
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const FIELDS = ['title', 'area', 'startsAt', 'timezone', 'capacity'];

/** Publishes a slot. The form checks nothing itself (W1); the server's field errors show next to the fields. */
function NewSlotDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateSlot();
  const errors = fieldErrors(create.error);
  const otherErrors = Object.entries(errors).filter(([field]) => !FIELDS.includes(field));
  const failedOtherwise = create.isError && Object.keys(errors).length === 0;

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
          <Plus aria-hidden="true" /> New slot
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New delivery slot</DialogTitle>
          <DialogDescription>
            How many deliveries you can make in this window, for example one per truck.
          </DialogDescription>
        </DialogHeader>
        <form
          id="new-slot"
          className="space-y-4"
          noValidate
          onSubmit={(submitted) => {
            submitted.preventDefault();
            const form = new FormData(submitted.currentTarget);
            const text = (name: string) => {
              const value = form.get(name);
              return typeof value === 'string' ? value : '';
            };
            const local = text('startsAt');
            create.mutate(
              {
                title: text('title'),
                area: text('area'),
                startsAt: local ? new Date(local).toISOString() : '',
                timezone: TIME_ZONE,
                capacity: Number(text('capacity')),
              },
              {
                onSuccess: (slot) => {
                  toast.success(`Published ${slot.title}.`);
                  setOpen(false);
                  create.reset();
                },
                onError: (error) => {
                  if (Object.keys(fieldErrors(error)).length === 0) toast.error(explain(error, 'create-slot').title);
                },
              },
            );
          }}
        >
          <Field id="slot-title" label="Title" error={errors.title}>
            <Input
              id="slot-title"
              name="title"
              placeholder="Lumber run"
              autoComplete="off"
              aria-invalid={Boolean(errors.title)}
            />
          </Field>
          <Field id="slot-area" label="Area" error={errors.area}>
            <Input
              id="slot-area"
              name="area"
              placeholder="Downtown"
              autoComplete="off"
              aria-invalid={Boolean(errors.area)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="slot-start"
              label="Starts"
              hint={`Your time zone: ${TIME_ZONE}`}
              error={errors.startsAt ?? errors.timezone}
            >
              <Input
                id="slot-start"
                name="startsAt"
                type="datetime-local"
                aria-invalid={Boolean(errors.startsAt ?? errors.timezone)}
              />
            </Field>
            <Field id="slot-capacity" label="Deliveries" error={errors.capacity}>
              <Input
                id="slot-capacity"
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
          {failedOtherwise && <ProblemNotice error={create.error} action="create-slot" />}
        </form>
        <DialogFooter>
          <Button type="submit" form="new-slot" disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Publish slot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
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
