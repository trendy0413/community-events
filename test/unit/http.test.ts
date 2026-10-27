import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type App, buildApp } from '../../src/http/app.js';
import { LOCAL_DATABASE_URL } from '../../src/config.js';
import { createDb } from '../../src/db/client.js';
import { DomainError, type Problem } from '../../src/http/errors.js';

// These tests use only the routes added below, outside the /v1 identity
// scope, so the database is never queried and need not be running.
const db = createDb(LOCAL_DATABASE_URL);
let app: App | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});
afterAll(() => db.destroy());

async function appWithTestRoutes(): Promise<App> {
  app = await buildApp({ db, authMode: 'dev-stub', logLevel: 'silent' });
  app.post('/v1/test/validate', { schema: { body: z.object({ capacity: z.number().int().min(1) }) } }, () => ({ ok: true }));
  app.get('/v1/test/full', () => {
    throw new DomainError('EVENT_FULL', 'All 10 seats are taken.');
  });
  app.get('/v1/test/boom', () => {
    throw new Error('secret internal detail');
  });
  await app.ready();
  return app;
}

const PROBLEM_JSON = /^application\/problem\+json/;

// The shared HTTP contract (SPEC sections 6 and 7): every error has one shape,
// and /v1 responses are never cached.
describe('HTTP contract', () => {
  it('answers an unknown route with NOT_FOUND', async () => {
    const res = await (await appWithTestRoutes()).inject({ method: 'GET', url: '/v1/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'This route does not exist.',
    });
  });

  it('maps a validation failure to VALIDATION_FAILED with field errors', async () => {
    const res = await (await appWithTestRoutes()).inject({
      method: 'POST',
      url: '/v1/test/validate',
      payload: { capacity: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(PROBLEM_JSON);
    const body = res.json<Problem>();
    expect(body.errors?.[0]?.message).toBeTruthy();
    expect(body).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: 'The request has invalid fields.',
      errors: [{ field: 'capacity', message: body.errors?.[0]?.message }],
    });
  });

  it('maps a body that is not valid JSON to VALIDATION_FAILED', async () => {
    const res = await (await appWithTestRoutes()).inject({
      method: 'POST',
      url: '/v1/test/validate',
      headers: { 'content-type': 'application/json' },
      payload: '{"capacity": ',
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(PROBLEM_JSON);
    const body = res.json<Problem>();
    expect(body.errors?.[0]?.message).toBeTruthy();
    expect(body).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: 'The request has invalid fields.',
      errors: [{ field: 'request', message: body.errors?.[0]?.message }],
    });
  });

  it('maps a malformed URL to VALIDATION_FAILED, not the framework default', async () => {
    const res = await (await appWithTestRoutes()).inject({ method: 'GET', url: '/v1/events/%zz' });

    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(PROBLEM_JSON);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', errors: [{ field: 'url' }] });
  });

  it('maps a DomainError to its SPEC status and code', async () => {
    const res = await (await appWithTestRoutes()).inject({ method: 'GET', url: '/v1/test/full' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      code: 'EVENT_FULL',
      detail: 'All 10 seats are taken.',
    });
  });

  it('hides internal errors behind INTERNAL_ERROR, with no stack trace and no cache', async () => {
    const res = await (await appWithTestRoutes()).inject({ method: 'GET', url: '/v1/test/boom' });

    expect(res.statusCode).toBe(500);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'Something went wrong on our side. Please try again.',
    });
    expect(res.body).not.toContain('secret internal detail');
  });
});

describe('docs', () => {
  it('serves Swagger UI at /docs and the contract at /openapi.json', async () => {
    const server = await appWithTestRoutes();

    const docs = await server.inject({ method: 'GET', url: '/docs' });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers['content-type']).toMatch(/^text\/html/);
    const contract = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(contract.json()).toMatchObject({ openapi: '3.1.0' });
  });

  it('sends security headers: nothing may load from an API answer, Swagger UI runs only its own scripts', async () => {
    const server = await appWithTestRoutes();

    const answer = await server.inject({ method: 'GET', url: '/v1/test/full' });
    expect(answer.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none'");
    expect(answer.headers['x-content-type-options']).toBe('nosniff');
    const docs = await server.inject({ method: 'GET', url: '/docs' });
    expect(docs.headers['content-security-policy']).toContain("script-src 'self' ;");
  });
});
