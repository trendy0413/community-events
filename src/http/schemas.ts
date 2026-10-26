import { z } from 'zod';

// Shared request and response schemas. Zod validates every input, and each
// /v1 route also declares its responses: the server sends only the fields
// listed there, so a new database column never leaks (SPEC section 6).

export const ProblemSchema = z
  .object({
    type: z.literal('about:blank'),
    title: z.string(),
    status: z.number().int(),
    code: z.enum([
      'VALIDATION_FAILED',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'EVENT_FULL',
      'EVENT_STARTED',
      'CAPACITY_BELOW_REGISTERED',
      'INTERNAL_ERROR',
    ]),
    detail: z.string(),
    errors: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  })
  .describe('Error in the problem+json shape (SPEC section 7)');

const PROBLEM_RESPONSE = {
  description: 'Error (SPEC section 7). Clients switch on `code`.',
  content: { 'application/problem+json': { schema: ProblemSchema } },
};

type ErrorStatus = 400 | 401 | 403 | 404 | 409;

/**
 * Error responses a route can return, plus 500, which any route can. They
 * are declared with the content type the server really sends, so generated
 * clients read error bodies as problem+json.
 */
export function problems<S extends ErrorStatus>(...statuses: S[]): Record<S | 500, typeof PROBLEM_RESPONSE> {
  return Object.fromEntries([...statuses, 500].map((status) => [status, PROBLEM_RESPONSE])) as Record<
    S | 500,
    typeof PROBLEM_RESPONSE
  >;
}

export const EventIdParams = z.object({ id: z.uuid() });
