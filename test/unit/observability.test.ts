import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type App, buildApp } from '../../src/http/app.js';
import { LOCAL_DATABASE_URL, loadConfig } from '../../src/config.js';
import { createDb } from '../../src/db/client.js';
import { DomainError, type ErrorReport } from '../../src/http/errors.js';
import { scrubEvent } from '../../src/observability/sentry.js';

// SPEC section 15. Only routes outside the /v1 identity scope are called, so
// the database is never queried and need not be running.
const db = createDb(LOCAL_DATABASE_URL);
let app: App | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => db.destroy());

interface LogLine {
  reqId?: string;
  msg?: string;
}

async function observedApp() {
  const lines: LogLine[] = [];
  const reports: { error: unknown; report: ErrorReport }[] = [];
  app = await buildApp({
    db,
    authMode: 'dev-stub',
    logLevel: 'info',
    logStream: { write: (line) => lines.push(JSON.parse(line) as LogLine) },
    reportError: (error, report) => {
      reports.push({ error, report });
      return Promise.resolve();
    },
  });
  app.get('/test/log', (request) => {
    request.log.info('a line from the handler');
    return { ok: true };
  });
  app.get('/test/boom/:id', () => {
    throw new Error('secret internal detail');
  });
  app.get('/test/full', () => {
    throw new DomainError('EVENT_FULL', 'All 10 seats are taken.');
  });
  app.post('/test/validate', { schema: { body: z.object({ capacity: z.number().int() }) } }, () => ({ ok: true }));
  await app.ready();
  return { app, lines, reports };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('request ids', () => {
  it('O1 every response carries a request id', async () => {
    const { app } = await observedApp();
    const answers = await Promise.all([
      app.inject({ method: 'GET', url: '/test/log' }),
      app.inject({ method: 'GET', url: '/test/full' }),
      app.inject({ method: 'GET', url: '/test/boom/1' }),
      app.inject({ method: 'GET', url: '/v1/nope' }),
      // A malformed URL fails before routing, in Fastify's own handler.
      app.inject({ method: 'GET', url: '/v1/events/%E0%A4%A' }),
    ]);

    const ids = answers.map((res) => res.headers['x-request-id']);
    for (const id of ids) expect(id).toMatch(UUID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('O1 every log line of a request carries its request id', async () => {
    const { app, lines } = await observedApp();

    const ok = await app.inject({ method: 'GET', url: '/test/log' });
    const boom = await app.inject({ method: 'GET', url: '/test/boom/1' });

    for (const res of [ok, boom]) {
      const id = String(res.headers['x-request-id']);
      const own = lines.filter((line) => line.reqId === id);
      // Fastify's "incoming request" and "request completed", plus the
      // handler's line or the error line.
      expect(own.length).toBeGreaterThanOrEqual(3);
    }
    expect(lines.find((line) => line.msg === 'a line from the handler')?.reqId).toBe(ok.headers['x-request-id']);
    expect(lines.find((line) => line.msg === 'unhandled error')?.reqId).toBe(boom.headers['x-request-id']);
    // Lines written while a request was handled all have an id.
    expect(lines.filter((line) => line.reqId === undefined)).toEqual([]);
  });

  it('O1 a safe incoming request id is kept and any other is replaced', async () => {
    const { app, lines } = await observedApp();
    const sent = async (id: string) =>
      String((await app.inject({ method: 'GET', url: '/test/log', headers: { 'x-request-id': id } })).headers['x-request-id']);

    expect(await sent('0f2c9a7e41b3d5c8e6a1f0b2c3d4e5f6')).toBe('0f2c9a7e41b3d5c8e6a1f0b2c3d4e5f6');
    expect(await sent('iad1::abc12-1730000000000-0123456789ab')).toBe('iad1::abc12-1730000000000-0123456789ab');

    for (const unsafe of ['', 'two words', 'tab\there', '{"msg":"forged"}', 'x'.repeat(129)]) {
      expect(await sent(unsafe)).toMatch(UUID);
    }
    expect(lines.some((line) => line.reqId === '{"msg":"forged"}')).toBe(false);
  });
});

describe('error reports', () => {
  it('O2 an unexpected error is reported with its request id', async () => {
    const { app, reports } = await observedApp();

    const res = await app.inject({ method: 'GET', url: '/test/boom/42' });

    expect(res.statusCode).toBe(500);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.error).toBeInstanceOf(Error);
    expect(reports[0]?.report).toEqual({
      requestId: res.headers['x-request-id'],
      method: 'GET',
      // The route pattern, not the URL, so reports for different ids group together.
      route: '/test/boom/:id',
    });
  });

  it('O2 client errors are not reported', async () => {
    const { app, reports } = await observedApp();

    const answers = await Promise.all([
      app.inject({ method: 'GET', url: '/test/full' }),
      app.inject({ method: 'POST', url: '/test/validate', payload: { capacity: 'ten' } }),
      app.inject({ method: 'POST', url: '/test/validate', headers: { 'content-type': 'application/json' }, payload: '{' }),
      app.inject({ method: 'GET', url: '/v1/nope' }),
      app.inject({ method: 'GET', url: '/v1/me' }),
    ]);

    expect(answers.map((res) => res.statusCode)).toEqual([409, 400, 400, 404, 401]);
    expect(reports).toEqual([]);
  });

  it('O2 error reports leave out the request and the user', () => {
    const event = {
      message: 'boom',
      tags: { requestId: 'r1', method: 'GET', route: '/v1/events/:id' },
      request: { headers: { 'x-dev-user-id': '0d3c2f6e-1a1b-4c00-8a01-000000000001' }, data: '{"jobsite":"5 Main St"}' },
      user: { id: '0d3c2f6e-1a1b-4c00-8a01-000000000001', ip_address: '203.0.113.7' },
    };

    expect(scrubEvent(event)).toEqual({
      message: 'boom',
      tags: { requestId: 'r1', method: 'GET', route: '/v1/events/:id' },
    });
  });

  it('still answers 500 when the error tracker fails', async () => {
    app = await buildApp({
      db,
      authMode: 'dev-stub',
      logLevel: 'silent',
      reportError: () => Promise.reject(new Error('tracker down')),
    });
    app.get('/test/boom', () => {
      throw new Error('boom');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('turns error tracking on only with a SENTRY_DSN', () => {
    expect(loadConfig({}).sentry).toBeUndefined();
    expect(loadConfig({ SENTRY_DSN: '' }).sentry).toBeUndefined();
    expect(
      loadConfig({ SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1', SENTRY_ENVIRONMENT: 'demo', VERCEL_GIT_COMMIT_SHA: 'abc' })
        .sentry,
    ).toEqual({ dsn: 'https://key@o1.ingest.sentry.io/1', environment: 'demo', release: 'abc' });
    expect(() => loadConfig({ SENTRY_DSN: 'not a url' })).toThrow(/SENTRY_DSN/);
  });
});
