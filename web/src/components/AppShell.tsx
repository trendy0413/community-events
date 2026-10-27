import { CalendarCheck } from 'lucide-react';
import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router';
import { cn } from '@/lib/utils';
import { REPO_URL } from '../links';
import { PersonSwitcher } from './PersonSwitcher';
import { ServerStatus } from './ServerStatus';

const NAV = [
  { to: '/events', label: 'Events' },
  { to: '/me/registrations', label: 'My registrations' },
  { to: '/organizer', label: 'Organizer' },
  { to: '/admin', label: 'Admin' },
  { to: '/proof', label: 'Try to overbook it' },
];

export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <p className="bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        Demo: pick a person, no password. Fake data only, reset every night. Real sign-in is not built yet.
      </p>
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <CalendarCheck className="size-5 text-primary" aria-hidden="true" />
            <span>Community Events</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ServerStatus className="hidden sm:inline-flex" />
            <PersonSwitcher />
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto max-w-5xl overflow-x-auto px-2">
          <ul className="flex gap-1 pb-2">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                      isActive && 'bg-muted font-medium text-foreground',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">
        <ServerStatus className="mb-4 sm:hidden" />
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-xs text-muted-foreground">
          <span>Every button calls the live API and a real PostgreSQL database.</span>
          <a className="underline-offset-4 hover:underline" href="/docs">
            API docs (Swagger)
          </a>
          <a className="underline-offset-4 hover:underline" href={REPO_URL}>
            Source and tests
          </a>
        </div>
      </footer>
      <ScrollRestoration />
    </div>
  );
}
