import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_ENDPOINTS, pathParamNames } from './endpoints.js';
import {
  OPENAPI_VERSION,
  openApiDocument,
  openApiJson,
  openApiPath,
} from './openapi.js';

const CHECKED_IN = fileURLToPath(
  new URL('../../../../docs/api/openapi.json', import.meta.url),
);

type Json = Record<string, unknown>;
const doc = openApiDocument();
const paths = doc['paths'] as Record<string, Record<string, Json>>;
const operations = Object.entries(paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, op]) => ({ path, method, op })),
);

function refs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(refs);
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) =>
      key === '$ref' && typeof inner === 'string' ? [inner] : refs(inner),
    );
  }
  return [];
}

describe('OpenAPI document (task 05B)', () => {
  it('is checked in up to date (run `pnpm openapi` after changing the contract)', () => {
    expect(readFileSync(CHECKED_IN, 'utf8').replace(/\r\n/g, '\n')).toBe(
      openApiJson(),
    );
  });

  it('describes every endpoint once, under its operationId', () => {
    expect(doc['openapi']).toBe(OPENAPI_VERSION);
    expect(operations).toHaveLength(ALL_ENDPOINTS.length);
    for (const spec of ALL_ENDPOINTS) {
      const op = paths[openApiPath(spec.path)]?.[spec.method.toLowerCase()];
      expect(op?.['operationId'], spec.id).toBe(spec.id);
    }
  });

  it('declares each path parameter, required, and nothing else in the path', () => {
    for (const { path, op } of operations) {
      const declared = ((op['parameters'] ?? []) as Json[])
        .filter((p) => p['in'] === 'path')
        .map((p) => {
          expect(p['required'], path).toBe(true);
          return p['name'];
        });
      const inTemplate = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(declared.sort(), path).toEqual(inTemplate.sort());
      expect(inTemplate.sort()).toEqual(
        pathParamNames(path.replace(/\{(\w+)\}/g, ':$1')).sort(),
      );
    }
  });

  it('gives every response a description and resolves every reference', () => {
    const components = doc['components'] as Record<string, Json>;
    const tags = new Set(
      (doc['tags'] as { name: string }[]).map((tag) => tag.name),
    );
    for (const { path, op } of operations) {
      for (const response of Object.values(op['responses'] as Json)) {
        expect(typeof (response as Json)['description'], path).toBe('string');
      }
      for (const tag of op['tags'] as string[]) {
        expect(tags.has(tag), `${path}: tag ${tag}`).toBe(true);
      }
    }
    for (const ref of refs(doc)) {
      const [, section, name] = /^#\/components\/(\w+)\/(\w+)$/.exec(ref) ?? [];
      expect(components[section ?? '']?.[name ?? ''], ref).toBeDefined();
    }
  });

  it('marks who may call each route', () => {
    const op = (path: string, method: string): Json =>
      paths[path]?.[method] ?? {};
    expect(op('/auth/login', 'post')['security']).toEqual([]);
    expect(op('/workspaces/{workspaceId}/members', 'get')['security']).toEqual([
      { sessionCookie: [] },
    ]);
    expect(
      op('/workspaces/{workspaceId}/invitations', 'post')['security'],
    ).toEqual([{ sessionCookie: [], csrfToken: [] }]);
    expect(op('/workspaces/{workspaceId}/members', 'get')['x-permission']).toBe(
      'members.read',
    );
    expect(op('/workspaces/{workspaceId}/members', 'get')['x-cache']).toEqual({
      resource: 'members',
      scope: 'workspace',
    });
    // Never a token in a response schema's property names or in a parameter.
    const text = openApiJson();
    expect(text).not.toMatch(/"(sessionToken|password_hash|tokenHash)"/);
  });
});
