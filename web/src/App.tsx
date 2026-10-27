import { useEffect, useState } from 'react';
import { api, unwrap, type Schemas } from './api/client';

export function App() {
  const [health, setHealth] = useState<Schemas['Health'] | 'unreachable' | null>(null);

  useEffect(() => {
    unwrap(api.GET('/v1/health')).then(setHealth, () => {
      setHealth('unreachable');
    });
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Community Events</h1>
      <p className="mt-2 text-muted-foreground" aria-live="polite">
        {health === null && 'Waking the server…'}
        {health === 'unreachable' && 'The server could not be reached.'}
        {typeof health === 'object' && health !== null && `Server: ${health.status}, database: ${health.db}.`}
      </p>
    </main>
  );
}
