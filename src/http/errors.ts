import { STATUS_CODES } from 'node:http';
import type { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';

// The codes and statuses from SPEC section 7. Clients switch on `code`, so
// codes are stable; `detail` is for people and may change.
const STATUS_BY_CODE = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EVENT_FULL: 409,
  EVENT_STARTED: 409,
  CAPACITY_BELOW_REGISTERED: 409,
  // The supply flow (SPEC section 14).
  SLOT_FULL: 409,
  SLOT_STARTED: 409,
  ORDER_ID_IN_USE: 409,
  ORDER_CLAIMED: 409,
  JOB_TAKEN: 409,
  JOB_NOT_OPEN: 409,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof STATUS_BY_CODE;

export interface FieldError {
  field: string;
  message: string;
}

export interface Problem {
  type: 'about:blank';
  title: string;
  status: number;
  code: ErrorCode;
  detail: string;
  errors?: FieldError[];
}

/** An expected failure that maps to one SPEC error code. */
export class DomainError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    detail: string,
  ) {
    super(detail);
    this.name = 'DomainError';
    this.status = STATUS_BY_CODE[code];
  }
}

/** The status always comes from the code, so the two can never disagree. */
export function problem(code: ErrorCode, detail: string, errors?: FieldError[]): Problem {
  const status = STATUS_BY_CODE[code];
  return {
    type: 'about:blank',
    // RFC 9457: with type "about:blank", the title is the HTTP status phrase.
    title: STATUS_CODES[status] ?? 'Error',
    status,
    code,
    detail,
    ...(errors ? { errors } : {}),
  };
}

function send(reply: FastifyReply, body: Problem): FastifyReply {
  return reply.status(body.status).type('application/problem+json').send(body);
}

const GENERIC_DETAIL = 'Something went wrong on our side. Please try again.';
const INVALID_REQUEST = 'The request has invalid fields.';

function frameworkErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' && error.code.startsWith('FST_ERR_') ? error.code : undefined;
}

/**
 * Errors Fastify raises before routing (a malformed URL), which never reach
 * the normal error handler. Same shape and headers as every other error.
 */
export const frameworkErrors: NonNullable<FastifyServerOptions['frameworkErrors']> = (error, request, reply) => {
  // The onRequest hook never runs for these, so its headers are set here (O1).
  void reply.header('x-request-id', request.id);
  if (request.url.startsWith('/v1')) void reply.header('cache-control', 'no-store');
  void send(reply, problem('VALIDATION_FAILED', INVALID_REQUEST, [{ field: 'url', message: error.message }]));
};

/** What the error tracker hears about a request that failed on our side (O2). */
export interface ErrorReport {
  requestId: string;
  method: string;
  /** The route pattern, for example /v1/events/:id, so ids never group apart. */
  route: string;
}

/** Sends a server error to the error tracker. Resolves once it is sent or given up. */
export type ReportError = (error: unknown, report: ErrorReport) => Promise<void>;

export const reportNothing: ReportError = () => Promise.resolve();

export function registerErrorHandling(app: FastifyInstance, reportError: ReportError = reportNothing): void {
  app.setNotFoundHandler((_request, reply) => send(reply, problem('NOT_FOUND', 'This route does not exist.')));

  const serverError = async (error: unknown, request: FastifyRequest, reply: FastifyReply, message: string) => {
    request.log.error({ err: error }, message);
    // A tracker that is slow or down must not turn the 500 into a hang.
    await reportError(error, {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url ?? 'unknown route',
    }).catch((reportFailure: unknown) => {
      request.log.warn({ err: reportFailure }, 'error report failed');
    });
    return send(reply, problem('INTERNAL_ERROR', GENERIC_DETAIL));
  };

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof DomainError) {
      return send(reply, problem(error.code, error.message));
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const errors = error.validation.map((issue) => ({
        field: issue.instancePath.replace(/^\//, '').replaceAll('/', '.') || (error.validationContext ?? 'request'),
        message: issue.message ?? 'Invalid value',
      }));
      return send(reply, problem('VALIDATION_FAILED', INVALID_REQUEST, errors));
    }

    // A response that does not match its schema is a server bug: never send
    // the partial body, and log the cause for us, not the client.
    if (isResponseSerializationError(error)) {
      return serverError(error, request, reply, 'response did not match its schema');
    }

    // Fastify's own request errors (bad JSON, wrong content type, body too
    // large) are the client's to fix. Their messages are written for clients,
    // so they are safe to show; messages of other errors are not.
    if (frameworkErrorCode(error) && error instanceof Error && 'statusCode' in error && Number(error.statusCode) < 500) {
      return send(reply, problem('VALIDATION_FAILED', INVALID_REQUEST, [{ field: 'request', message: error.message }]));
    }

    return serverError(error, request, reply, 'unhandled error');
  });
}
