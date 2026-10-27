import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from './components/AppShell';
import { AdminPage } from './pages/AdminPage';
import { EventPage } from './pages/EventPage';
import { EventsPage } from './pages/EventsPage';
import { MyRegistrationsPage } from './pages/MyRegistrationsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrganizerPage } from './pages/OrganizerPage';
import { StartPage } from './pages/StartPage';
import { JobsPage } from './pages/supply/JobsPage';
import { MyOrdersPage } from './pages/supply/MyOrdersPage';
import { SlotsPage } from './pages/supply/SlotsPage';
import { SupplierPage } from './pages/supply/SupplierPage';
import { SupplyLayout } from './pages/supply/SupplyLayout';
import { ProofPage } from './proof/ProofPage';

const queryClient = new QueryClient({
  defaultOptions: {
    // Seat counts change while the page is open; refetch when the visitor comes back.
    queries: { staleTime: 5_000, refetchOnWindowFocus: true },
  },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <StartPage /> },
      { path: '/events', element: <EventsPage /> },
      { path: '/events/:id', element: <EventPage /> },
      { path: '/me/registrations', element: <MyRegistrationsPage /> },
      { path: '/organizer', element: <OrganizerPage /> },
      { path: '/admin', element: <AdminPage /> },
      {
        path: '/supply',
        element: <SupplyLayout />,
        children: [
          { index: true, element: <SlotsPage /> },
          { path: 'orders', element: <MyOrdersPage /> },
          { path: 'supplier', element: <SupplierPage /> },
          { path: 'jobs', element: <JobsPage /> },
        ],
      },
      { path: '/proof', element: <ProofPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        {/* The app has light colors only; sonner would otherwise follow a dark OS setting. */}
        <Toaster position="top-center" theme="light" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
