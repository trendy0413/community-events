import { toast } from 'sonner';
import { type Action, explain } from '../api/problems';

/** A failed write, as a toast: plain words plus the server's real answer. */
export function showProblem(error: unknown, action: Action): void {
  const { title, detail, answer } = explain(error, action);
  toast.error(title, { description: `The server answered ${answer}${detail ? `: ${detail}` : '.'}` });
}
