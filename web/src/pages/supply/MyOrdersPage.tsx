import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Schemas } from '../../api/client';
import { useCancelOrder, useMyOrders } from '../../api/queries';
import { showProblem } from '../../components/notify';
import { EmptyState, LoadProblem } from '../../components/States';
import { eventStart, moment } from '../../lib/format';
import { OrderStatusBadge } from './parts';

export function MyOrdersPage() {
  const orders = useMyOrders();
  return (
    <>
      {orders.isPending && <Skeleton className="h-40 rounded-xl" />}
      {orders.isError && <LoadProblem error={orders.error} action="my-orders" />}
      {orders.isSuccess &&
        (orders.data.orders.length === 0 ? (
          <EmptyState title="No orders yet">Order a delivery from one of the slots.</EmptyState>
        ) : (
          <ul className="divide-y rounded-xl border">
            {orders.data.orders.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </ul>
        ))}
    </>
  );
}

function OrderRow({ order }: { order: Schemas['Order'] }) {
  const cancel = useCancelOrder(order.id);
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{order.items}</span>
          <OrderStatusBadge status={order.status} driver={order.driver} />
        </div>
        <p className="text-sm text-muted-foreground">To {order.jobsite}</p>
        <p className="text-xs text-muted-foreground">
          {order.slot.title}, {order.slot.supplier.name}, {eventStart(order.slot.startsAt, order.slot.timezone)} ·
          ordered {moment(order.createdAt)}
        </p>
      </div>
      {/* Offered for every open order, taken by a driver or not: the server decides (S3) and says why it refuses. */}
      {(order.status === 'booked' || order.status === 'claimed') && (
        <Button
          variant="outline"
          disabled={cancel.isPending}
          onClick={() => {
            cancel.mutate(undefined, {
              onSuccess: () => toast.success('Order cancelled. The delivery is free for someone else.'),
              onError: (error) => {
                showProblem(error, 'cancel-order');
              },
            });
          }}
        >
          {cancel.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Cancel order
        </Button>
      )}
    </li>
  );
}
