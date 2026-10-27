import { describe, expect, it } from 'vitest';
import { ApiError, createApi, unwrap } from './client';

const json = (status: number, body: unknown, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

describe('unwrap', () => {
  it('returns the body of a successful call', async () => {
    const api = createApi({ baseUrl: 'http://api.test', fetch: () => Promise.resolve(json(200, { status: 'ok', db: 'ok', identity: 'dev-stub' })) });

    await expect(unwrap(api.GET('/v1/health'))).resolves.toEqual({ status: 'ok', db: 'ok', identity: 'dev-stub' });
  });

  it('turns a problem+json answer into an ApiError with its code', async () => {
    const problem = { type: 'about:blank', title: 'Conflict', status: 409, code: 'EVENT_FULL', detail: 'All 10 seats are taken.' };
    const api = createApi({ baseUrl: 'http://api.test', fetch: () => Promise.resolve(json(409, problem, 'application/problem+json')) });

    const error = await unwrap(api.GET('/v1/me')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, problem: { code: 'EVENT_FULL' } });
  });

  it('keeps the status when something in front of the API answers without a problem body', async () => {
    const api = createApi({ baseUrl: 'http://api.test', fetch: () => Promise.resolve(new Response('Too Many Requests', { status: 429 })) });

    await expect(unwrap(api.GET('/v1/me'))).rejects.toMatchObject({ status: 429, problem: null });
  });

  it('reports status 0 when the server cannot be reached', async () => {
    const api = createApi({ baseUrl: 'http://api.test', fetch: () => Promise.reject(new TypeError('Failed to fetch')) });

    await expect(unwrap(api.GET('/v1/me'))).rejects.toMatchObject({ status: 0, problem: null });
  });
});
