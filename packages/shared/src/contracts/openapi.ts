// The API's OpenAPI document, generated from the endpoint list (task 05B, docs/decisions.md
// D-05B-02). docs/api/openapi.json is this output; a test fails when it is out of date
// (`pnpm openapi` rewrites it). Schemas come from the same zod contracts the API validates with
// (z.toJSONSchema, JSON Schema 2020-12), so the document can't drift from the validation.
import { z } from 'zod';
import { CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from './auth.js';
import {
  ALL_ENDPOINTS,
  API_ERROR_STATUS,
  CACHE_RESOURCES,
  ENDPOINT_TAGS,
  endpointErrorCodes,
  needsCsrfToken,
  type EndpointSpec,
} from './endpoints.js';
import { apiErrorResponseSchema } from './workspaces.js';

/** OpenAPI 3.1.2 (published 2025-09-19), checked 2026-11-02 at https://spec.openapis.org/oas/. */
export const OPENAPI_VERSION = '3.1.2';

/** Version of the API described; raised when the contract changes incompatibly. */
export const API_VERSION = '0.5.0';

type JsonObject = Record<string, unknown>;

const JSON_CONTENT = 'application/json';
const ERROR_REF = { $ref: '#/components/schemas/ApiError' };

const SUCCESS_DESCRIPTIONS: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No content',
};

/** A zod schema as JSON Schema 2020-12; throws for anything JSON Schema can't express. */
function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonObject {
  const json: JsonObject = {
    ...z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io,
      unrepresentable: 'throw',
    }),
  };
  delete json['$schema'];
  return json;
}

/** Parameter objects for the properties of an object schema (path, query or header). */
function parameters(
  schema: z.ZodObject | undefined,
  location: 'path' | 'query' | 'header',
): JsonObject[] {
  if (schema === undefined) {
    return [];
  }
  const json = jsonSchema(schema, 'input');
  const properties = (json['properties'] ?? {}) as Record<string, JsonObject>;
  const required = new Set((json['required'] ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: location,
    required: location === 'path' || required.has(name),
    schema: property,
  }));
}

function security(spec: EndpointSpec): JsonObject[] {
  if (spec.access === 'public') {
    return [];
  }
  return [
    needsCsrfToken(spec)
      ? { sessionCookie: [], csrfToken: [] }
      : { sessionCookie: [] },
  ];
}

function responses(spec: EndpointSpec): JsonObject {
  const result: JsonObject = {
    [String(spec.status)]: {
      description: SUCCESS_DESCRIPTIONS[spec.status] ?? 'Success',
      ...(spec.response === null
        ? {}
        : {
            content: {
              [JSON_CONTENT]: { schema: jsonSchema(spec.response, 'output') },
            },
          }),
    },
  };
  for (const other of spec.otherResponses ?? []) {
    result[String(other.status)] = {
      description: other.description,
      content: {
        [JSON_CONTENT]: { schema: jsonSchema(other.schema, 'output') },
      },
    };
  }
  const byStatus = new Map<number, string[]>();
  for (const code of endpointErrorCodes(spec)) {
    const status = API_ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  for (const status of [...byStatus.keys()].sort((a, b) => a - b)) {
    const codes = byStatus.get(status) ?? [];
    result[String(status)] = {
      description: `Error: ${codes.join(', ')}.`,
      'x-error-codes': codes,
      content: { [JSON_CONTENT]: { schema: ERROR_REF } },
    };
  }
  return result;
}

function operation(spec: EndpointSpec): JsonObject {
  const parameterList = [
    ...parameters(spec.params, 'path'),
    ...parameters(spec.query, 'query'),
    ...parameters(spec.headers, 'header'),
  ];
  return {
    operationId: spec.id,
    tags: [spec.tag],
    summary: spec.summary,
    security: security(spec),
    'x-access': spec.access,
    ...(spec.permission === undefined
      ? {}
      : { 'x-permission': spec.permission }),
    ...(spec.cache === undefined
      ? {}
      : {
          'x-cache': {
            resource: spec.cache,
            scope: CACHE_RESOURCES[spec.cache],
          },
        }),
    ...(spec.invalidates === undefined
      ? {}
      : { 'x-invalidates': [...spec.invalidates] }),
    ...(parameterList.length === 0 ? {} : { parameters: parameterList }),
    ...(spec.body === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT]: { schema: jsonSchema(spec.body, 'input') },
            },
          },
        }),
    responses: responses(spec),
  };
}

/** `/workspaces/:workspaceId` → `/workspaces/{workspaceId}`. */
export function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z]\w*)/g, '{$1}');
}

export function openApiDocument(): JsonObject {
  const paths: Record<string, JsonObject> = {};
  for (const spec of ALL_ENDPOINTS) {
    const key = openApiPath(spec.path);
    paths[key] = {
      ...paths[key],
      [spec.method.toLowerCase()]: operation(spec),
    };
  }
  return {
    openapi: OPENAPI_VERSION,
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'Lead Fennec AI API',
      version: API_VERSION,
      description:
        'Generated from packages/shared/src/contracts/endpoints.ts; do not edit by hand. ' +
        'Browsers reach the auth, workspaces, invitations and platform routes through the ' +
        "web app's same-origin proxy at /api. Every response is JSON with Cache-Control: " +
        'no-store; errors use the ApiError envelope. x-access, x-permission, x-cache and ' +
        'x-invalidates describe who may call a route and how the web app caches its data.',
    },
    servers: [{ url: '/', description: 'The API origin (API_BASE_URL).' }],
    tags: ENDPOINT_TAGS.map((tag) => ({ ...tag })),
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: SESSION_COOKIE_NAME,
          description:
            'HttpOnly, Secure, SameSite=Lax. Set by POST /auth/login; never readable by scripts.',
        },
        csrfToken: {
          type: 'apiKey',
          in: 'header',
          name: CSRF_HEADER_NAME,
          description:
            "The session's CSRF token (GET /auth/session), required on every authenticated mutation.",
        },
      },
      schemas: { ApiError: jsonSchema(apiErrorResponseSchema, 'output') },
    },
  };
}

/** The document as written to docs/api/openapi.json. */
export function openApiJson(): string {
  return `${JSON.stringify(openApiDocument(), null, 2)}\n`;
}
