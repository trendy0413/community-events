import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from './components/AppShell';
import { EventPage } from './pages/EventPage';
import { EventsPage } from './pages/EventsPage';
import { MyRegistrationsPage } from './pages/MyRegistrationsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { StartPage } from './pages/StartPage';
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
        <Toaster position="top-center" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
