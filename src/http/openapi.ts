import type { SwaggerTransformObject } from '@fastify/swagger';
import { jsonSchemaTransformObject } from 'fastify-type-provider-zod';

type Document = ReturnType<SwaggerTransformObject>;
type Json = Record<string, unknown>;

const SCHEMA_PREFIX = '#/components/schemas/';
// Matches only `$ref` values: inside a JSON string every quote is escaped, so
// ref-like text in a summary or description cannot match.
const SCHEMA_REF = /"\$ref":"#\/components\/schemas\/([^"\\]+)"/g;

/**
 * Response headers that route schemas cannot declare: the Zod provider keeps
 * only the body of a response. Keyed by "METHOD path status".
 */
const RESPONSE_HEADERS: Record<string, Json> = {
  'post /v1/events 201': {
    Location: { description: 'Path of the new event, for example /v1/events/{id}', schema: { type: 'string' } },
  },
};

/**
 * Builds the contract's components. A schema named with `.meta({ id })`
 * becomes one shared component, so generated clients get types such as
 * `Event` and `Problem` instead of a separate anonymous copy per response.
 */
export const transformObject: SwaggerTransformObject = (document) => finishContract(jsonSchemaTransformObject(document));

/**
 * Fixes on top of the Zod provider's output:
 * - Only components some route uses are kept, sorted by name. The provider
 *   emits an input and an output variant of every named schema.
 * - Response schemas allow fields they do not list. Zod's output form
 *   forbids them, and some generated clients (Swift) then fail to decode
 *   every response once the API adds a field. The server still sends only
 *   the listed fields. Request bodies keep the ban: the server rejects
 *   unknown fields there (R10).
 * - The headers in RESPONSE_HEADERS are declared.
 */
export function finishContract(document: Document): Document {
  if (!('components' in document) || !('paths' in document)) return document;
  const contract = structuredClone(document) as unknown as { paths: Json; components?: { schemas?: Json } };
  const schemas = contract.components?.schemas ?? {};

  const used = new Set<string>();
  const markUsed = (value: unknown): void => {
    for (const [, name = ''] of JSON.stringify(value).matchAll(SCHEMA_REF)) {
      if (used.has(name)) continue;
      if (!(name in schemas)) throw new Error(`OpenAPI: $ref to unknown schema ${name}`);
      used.add(name);
      markUsed(schemas[name]);
    }
  };
  markUsed(contract.paths);

  const opened = new Set<string>();
  const allowUnlistedFields = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(allowUnlistedFields);
      return;
    }
    if (!isJson(node)) return;
    if (node.additionalProperties === false) delete node.additionalProperties;
    const ref = node.$ref;
    if (typeof ref === 'string' && ref.startsWith(SCHEMA_PREFIX)) {
      const name = ref.slice(SCHEMA_PREFIX.length);
      if (!opened.has(name)) {
        opened.add(name);
        allowUnlistedFields(schemas[name]);
      }
    }
    for (const key of ['items', 'additionalProperties', 'not']) allowUnlistedFields(node[key]);
    for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) allowUnlistedFields(node[key]);
    if (isJson(node.properties)) Object.values(node.properties).forEach(allowUnlistedFields);
  };
  for (const operation of operations(contract.paths)) {
    if (!isJson(operation.responses)) continue;
    for (const response of Object.values(operation.responses)) {
      if (isJson(response) && isJson(response.content)) {
        for (const media of Object.values(response.content)) {
          if (isJson(media)) allowUnlistedFields(media.schema);
        }
      }
    }
  }

  for (const [key, headers] of Object.entries(RESPONSE_HEADERS)) {
    const [method = '', path = '', status = ''] = key.split(' ');
    const operation = contract.paths[path];
    const responses = isJson(operation) && isJson(operation[method]) ? operation[method].responses : undefined;
    const response = isJson(responses) ? responses[status] : undefined;
    // A renamed route must not silently lose its documented headers.
    if (!isJson(response)) throw new Error(`OpenAPI: no response "${key}" to declare headers on`);
    response.headers = { ...(isJson(response.headers) ? response.headers : {}), ...headers };
  }

  if (contract.components) {
    // Sorted by name: the provider adds schemas in import order, and the
    // committed file should not change when imports are reordered.
    const kept = Object.entries(schemas).filter(([name]) => used.has(name));
    kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    contract.components.schemas = Object.fromEntries(kept);
  }
  return contract as Document;
}

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function operations(paths: Json): Json[] {
  return Object.values(paths)
    .filter(isJson)
    .flatMap((item) => Object.values(item).filter(isJson));
}
