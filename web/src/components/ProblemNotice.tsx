import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { type Action, explain } from '../api/problems';

/** The server's answer to a failed call, in plain words plus the real status and code. */
export function ProblemNotice({ error, action, className }: { error: unknown; action: Action; className?: string }) {
  const { title, detail, answer } = explain(error, action);
  return (
    <Alert className={className}>
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span>
          The server answered <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{answer}</code>
          {detail ? `: ${detail}` : '.'}
        </span>
      </AlertDescription>
    </Alert>
  );
}
