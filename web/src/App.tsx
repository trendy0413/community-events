import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from './components/AppShell';
import { NotFoundPage } from './pages/NotFoundPage';
import { StartPage } from './pages/StartPage';

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
