import createClient, { type Client, type Middleware } from 'openapi-fetch';
import { currentPersonId } from '../identity';
import type { components, paths } from './schema';

// The only way the web client talks to the API: a client generated from the
// contract (openapi/openapi.json), so every path, body and response is typed.
// Paths are relative: on the demo host the API and the web client share one
// origin, and in development Vite forwards /v1 to the API.

export type Api = Client<paths>;
export type Schemas = components['schemas'];
export type Problem = Schemas['Problem'];

export function createApi(options: { baseUrl?: string; fetch?: typeof fetch } = {}): Api {
  return createClient<paths>({ baseUrl: options.baseUrl ?? '', ...(options.fetch ? { fetch: options.fetch } : {}) });
}

export const IDENTITY_HEADER = 'X-Dev-User-Id';

/** Sends the picked person's id (SPEC section 9). A call that names its own person, as the proof page does, keeps it. */
const identity: Middleware = {
  onRequest({ request }) {
    const id = currentPersonId();
    if (id && !request.headers.has(IDENTITY_HEADER)) request.headers.set(IDENTITY_HEADER, id);
    return request;
  },
};

export const api = createApi();
api.use(identity);

/** Headers that make one call as the given person. */
export function as(personId: string): { headers: Record<string, string> } {
  return { headers: { [IDENTITY_HEADER]: personId } };
}

/** A failed call: the HTTP status (0 when the server could not be reached) and the problem+json body, if any. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | null,
  ) {
    super(problem?.detail ?? (status === 0 ? 'The server could not be reached.' : `The server answered ${status}.`));
    this.name = 'ApiError';
  }
}

function isProblem(value: unknown): value is Problem {
  return typeof value === 'object' && value !== null && 'code' in value && 'status' in value;
}

/**
 * The response body of a successful call, or an ApiError. The body of a
 * failed call is a Problem (SPEC section 7) unless something in front of the
 * API answered, for example the host's rate limit.
 */
export async function unwrap<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch {
    throw new ApiError(0, null);
  }
  if (!result.response.ok) throw new ApiError(result.response.status, isProblem(result.error) ? result.error : null);
  return result.data as T;
}
