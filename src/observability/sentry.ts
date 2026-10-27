import * as Sentry from '@sentry/node';
import type { ReportError } from '../http/errors.js';

export interface SentryOptions {
  dsn: string;
  environment: string;
  release?: string;
}

// How long a 500 may wait for its report. Serverless hosts can freeze the
// process right after the response, so the report is sent before it.
const FLUSH_TIMEOUT_MS = 2000;

/**
 * O2: events leave without the request or the user. The headers hold the
 * identity and the body may hold personal data; the request id, method and
 * route tags are enough to find the log lines.
 */
export function scrubEvent<E extends Sentry.Event>(event: E): E {
  delete event.request;
  delete event.user;
  return event;
}

/** Error tracking only (O2): no tracing or performance integrations. */
export function startSentry(options: SentryOptions): ReportError {
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    ...(options.release ? { release: options.release } : {}),
    defaultIntegrations: Sentry.getDefaultIntegrationsWithoutPerformance(),
    beforeSend: scrubEvent,
  });

  return async (error, report) => {
    Sentry.withScope((scope) => {
      scope.setTags({ requestId: report.requestId, method: report.method, route: report.route });
      Sentry.captureException(error);
    });
    await Sentry.flush(FLUSH_TIMEOUT_MS);
  };
}
