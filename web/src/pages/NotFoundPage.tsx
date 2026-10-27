import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="space-y-4 py-10 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">This page does not exist</h1>
      <Button asChild variant="outline">
        <Link to="/">Back to the start</Link>
      </Button>
    </div>
  );
}
