import { Truck } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { cn } from '@/lib/utils';

const TABS = [
  { to: '/supply', label: 'Delivery slots', end: true },
  { to: '/supply/orders', label: 'My orders' },
  { to: '/supply/supplier', label: 'Supplier' },
  { to: '/supply/jobs', label: 'Driver jobs' },
];

/** The jobsite supply flow (SPEC section 14): one tab per role. Every tab asks the server; none hides by role. */
export function SupplyLayout() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Truck className="size-6 text-primary" aria-hidden="true" />
          Jobsite supply
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A supplier publishes delivery slots with a fixed number of deliveries. A contractor orders material to a
          jobsite in a slot. A driver takes the delivery job; exactly one driver gets each job.
        </p>
      </header>
      <nav aria-label="Supply" className="overflow-x-auto border-b">
        <ul className="flex gap-1">
          {TABS.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    '-mb-px block border-b-2 px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground',
                    isActive ? 'border-primary font-medium text-foreground' : 'border-transparent',
                  )
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
