import { Validator } from '@seriousme/openapi-schema-validator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import { LOCAL_DATABASE_URL } from '../../src/config.js';
import { createDb } from '../../src/db/client.js';
import { finishContract } from '../../src/http/openapi.js';

// Reads only the contract, so the database is never queried and need not be running.
const db = createDb(LOCAL_DATABASE_URL);
let app: App;

beforeAll(async () => {
  app = await buildApp({ db, authMode: 'dev-stub', logLevel: 'silent' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

interface Contract {
  paths: Record<string, unknown>;
  components: { schemas: Record<string, unknown> };
}

const contract = async () => (await app.inject({ method: 'GET', url: '/openapi.json' })).json<Contract>();

describe('OpenAPI contract', () => {
  it('is valid OpenAPI 3.1 with every $ref resolved', async () => {
    const result = await new Validator().validate((await contract()) as unknown as Record<string, unknown>);
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it('names each shared schema once and keeps only the ones routes use', async () => {
    const { paths, components } = await contract();
    expect(Object.keys(components.schemas).sort()).toEqual([
      'AttendeeList',
      'ChangeCapacityInput',
      'CreateEventInput',
      'Event',
      'EventList',
      'Health',
      'MyRegistrations',
      'Problem',
      'Registration',
      'User',
    ]);
    // Error responses point at the one Problem component instead of each holding a copy.
    expect(JSON.stringify(paths)).not.toContain('VALIDATION_FAILED');
  });

  it('lets responses gain fields but rejects unknown fields in request bodies', async () => {
    const { paths, components } = await contract();
    const closed = (value: unknown) => JSON.stringify(value).includes('"additionalProperties":false');
    for (const [name, schema] of Object.entries(components.schemas)) {
      expect(closed(schema), name).toBe(name.endsWith('Input'));
    }
    const responses = Object.values(paths).flatMap((item) =>
      Object.values(item as Record<string, { responses: unknown }>).map((operation) => operation.responses),
    );
    expect(closed(responses)).toBe(false);
  });

  it('declares the Location header of a created event', async () => {
    const { paths } = await contract();
    const created = (paths['/v1/events'] as { post: { responses: Record<string, { headers?: Record<string, unknown> }> } }).post
      .responses['201'];
    expect(Object.keys(created?.headers ?? {})).toEqual(['Location']);
  });
});

describe('finishContract', () => {
  const schema = (properties: Record<string, unknown>) => ({ type: 'object', properties, additionalProperties: false });
  const document = (schemas: Record<string, unknown>, responseSchema: unknown, description = 'A list') => ({
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    paths: {
      '/v1/events': {
        post: {
          description,
          responses: {
            '201': { description: 'Created', content: { 'application/json': { schema: responseSchema } } },
          },
        },
      },
    },
    components: { schemas },
  });
  type Finished = { components: { schemas: Record<string, unknown> } };

  it('keeps schemas reached only through other schemas, and drops the rest', () => {
    const finished = finishContract(
      document(
        {
          List: schema({ items: { type: 'array', items: { $ref: '#/components/schemas/Item' } } }),
          Item: schema({ id: { type: 'string' } }),
          ListInput: schema({}),
        },
        { $ref: '#/components/schemas/List' },
      ),
    ) as Finished;
    expect(Object.keys(finished.components.schemas)).toEqual(['List', 'Item']);
    // Opened through the response, including the schema it points at.
    expect(JSON.stringify(finished.components.schemas)).not.toContain('additionalProperties');
  });

  it('ignores ref-like text that is not a $ref, and fails on a $ref to nothing', () => {
    const quoted = document({ Item: schema({}) }, { type: 'string' }, 'Same as "#/components/schemas/Item"');
    expect(Object.keys((finishContract(quoted) as Finished).components.schemas)).toEqual([]);

    expect(() => finishContract(document({}, { $ref: '#/components/schemas/Missing' }))).toThrow(/unknown schema Missing/);
  });
});
