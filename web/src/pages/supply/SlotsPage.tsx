import { useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { ApiError, type Schemas } from '../../api/client';
import { fieldErrors } from '../../api/problems';
import { usePlaceOrder, useSlots } from '../../api/queries';
import { showProblem } from '../../components/notify';
import { CardsSkeleton, EmptyState, LoadProblem } from '../../components/States';
import { supplyProof } from '../../demo/people';
import { SlotCard } from './parts';

export function SlotsPage() {
  const slots = useSlots();
  // Proof runs are demo machinery; the proof page links to its own slots.
  const shown = slots.data?.slots.filter((slot) => slot.supplier.id !== supplyProof.supplier.id) ?? [];

  return (
    <>
      {slots.isPending && <CardsSkeleton />}
      {slots.isError && <LoadProblem error={slots.error} action="load" />}
      {slots.isSuccess &&
        (shown.length === 0 ? (
          <EmptyState title="No upcoming delivery slots">A supplier can publish one.</EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((slot) => (
              <li key={slot.id}>
                <SlotCard slot={slot} footer={<OrderDialog slot={slot} />} />
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

/**
 * Orders a delivery. The order id is made once per dialog and sent again on
 * a retry, so a resend after a weak connection never books twice (S2). The
 * form checks nothing itself (W1).
 */
function OrderDialog({ slot }: { slot: Schemas['Slot'] }) {
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState(() => crypto.randomUUID());
  const place = usePlaceOrder(slot.id);
  const errors = fieldErrors(place.error);
  const otherErrors = Object.entries(errors).filter(([field]) => field !== 'items' && field !== 'jobsite');
  const itemsError = `items-error-${slot.id}`;
  const jobsiteError = `jobsite-error-${slot.id}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) place.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="w-full">Order a delivery</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Order a delivery</DialogTitle>
          <DialogDescription>
            {slot.title}, {slot.supplier.name}. The server checks the fields and the deliveries left.
          </DialogDescription>
        </DialogHeader>
        <form
          id={`order-${slot.id}`}
          className="space-y-4"
          noValidate
          onSubmit={(submitted) => {
            submitted.preventDefault();
            const form = new FormData(submitted.currentTarget);
            const text = (name: string) => {
              const value = form.get(name);
              return typeof value === 'string' ? value : '';
            };
            place.mutate(
              { orderId, body: { items: text('items'), jobsite: text('jobsite') } },
              {
                onSuccess: (placed) => {
                  // A resend returns the order as it is now, which may be cancelled (S2).
                  if (placed.status === 'cancelled')
                    toast.info('This order was placed earlier and has been cancelled since.');
                  else toast.success(`Ordered from ${slot.supplier.name}.`);
                  setOpen(false);
                  // The next order is a new one, with a new id.
                  setOrderId(crypto.randomUUID());
                  place.reset();
                },
                onError: (error) => {
                  // The id belongs to an order an earlier send placed with other
                  // fields; a new id makes the next send a new order.
                  if (error instanceof ApiError && error.problem?.code === 'ORDER_ID_IN_USE') {
                    setOrderId(crypto.randomUUID());
                  }
                  if (Object.keys(fieldErrors(error)).length === 0) showProblem(error, 'place-order');
                },
              },
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`items-${slot.id}`}>What to bring</Label>
            <Textarea
              id={`items-${slot.id}`}
              name="items"
              rows={3}
              aria-invalid={Boolean(errors.items)}
              aria-describedby={errors.items ? itemsError : undefined}
            />
            {errors.items && (
              <p id={itemsError} className="text-xs text-destructive" role="alert">
                {errors.items}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`jobsite-${slot.id}`}>Jobsite</Label>
            <Input
              id={`jobsite-${slot.id}`}
              name="jobsite"
              autoComplete="off"
              aria-invalid={Boolean(errors.jobsite)}
              aria-describedby={jobsiteError}
            />
            {errors.jobsite ? (
              <p id={jobsiteError} className="text-xs text-destructive" role="alert">
                {errors.jobsite}
              </p>
            ) : (
              <p id={jobsiteError} className="text-xs text-muted-foreground">
                Address and where to drop it, for example "gate B".
              </p>
            )}
          </div>
          {otherErrors.length > 0 && (
            <ul className="text-sm text-destructive" role="alert">
              {otherErrors.map(([field, message]) => (
                <li key={field}>
                  {field}: {message}
                </li>
              ))}
            </ul>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={`order-${slot.id}`} disabled={place.isPending}>
            {place.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Place order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
