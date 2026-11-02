// Test-only (excluded from the build): every route the application registers, with its guards,
// required permissions, success status and validation pipes, read from Nest's metadata. The app
// module is compiled but never started, so nothing is dialled. Used by the authorization review
// (route-guards.test.ts) and the API contract test (api-contract.test.ts).
import { Writable } from 'node:stream';
import { createLogger } from '@lead-fennec-ai/shared/logger';
import {
  RequestMethod,
  type CanActivate,
  type PipeTransform,
  type Type,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
} from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { apiEnvSchema } from '../env.js';
import { READINESS_CHECKS } from '../health/health.tokens.js';
import { REQUIRED_PERMISSIONS } from '../workspaces/workspace-guards.js';

export interface RegisteredRoute {
  /** `METHOD /path`, e.g. `GET /workspaces/:workspaceId/members`. */
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly guards: readonly Type<CanActivate>[];
  readonly permissions: readonly string[];
  /** @HttpCode, or Nest's default (201 for POST, 200 otherwise). */
  readonly status: number;
  /** Pipes on the @Body() and @Query() parameters. */
  readonly bodyPipes: readonly unknown[];
  readonly queryPipes: readonly unknown[];
}

interface RouteArgument {
  readonly index: number;
  readonly pipes?: readonly (PipeTransform | Type<PipeTransform>)[];
}

const joinPath = (...parts: unknown[]) =>
  '/' +
  parts
    .flatMap((part): unknown[] => (Array.isArray(part) ? part : [part]))
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '')
    .join('/');

const guardsOf = (target: object): Type<CanActivate>[] =>
  (Reflect.getMetadata(GUARDS_METADATA, target) as
    Type<CanActivate>[] | undefined) ?? [];

function pipesOf(
  args: Readonly<Record<string, RouteArgument>>,
  type: RouteParamtypes,
): unknown[] {
  return Object.entries(args)
    .filter(([key]) => key.split(':')[0] === String(type))
    .flatMap(([, argument]) => argument.pipes ?? []);
}

export async function registeredRoutes(): Promise<RegisteredRoute[]> {
  const env = apiEnvSchema.parse({
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/leadfennec_test',
    REDIS_URL: 'redis://127.0.0.1:1/15',
  });
  const logger = createLogger({
    app: 'api',
    level: 'silent',
    destination: new Writable({
      write: (_chunk, _encoding, done) => {
        done();
      },
    }),
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env, logger), DiscoveryModule],
  })
    .overrideProvider(READINESS_CHECKS)
    .useValue([])
    .compile();
  try {
    const scanner = new MetadataScanner();
    const routes: RegisteredRoute[] = [];
    for (const wrapper of moduleRef.get(DiscoveryService).getControllers()) {
      const controller = wrapper.metatype as Type | null;
      if (controller === null) {
        continue;
      }
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function') {
          continue;
        }
        const methodPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        if (methodPath === undefined) {
          continue;
        }
        const method =
          RequestMethod[
            Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod
          ];
        const path = joinPath(
          Reflect.getMetadata(PATH_METADATA, controller),
          methodPath,
        );
        const args =
          (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) as
            Record<string, RouteArgument> | undefined) ?? {};
        routes.push({
          id: `${method} ${path}`,
          method,
          path,
          guards: [...guardsOf(controller), ...guardsOf(handler)],
          permissions:
            (Reflect.getMetadata(REQUIRED_PERMISSIONS, handler) as
              string[] | undefined) ?? [],
          status:
            (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as
              number | undefined) ?? (method === 'POST' ? 201 : 200),
          bodyPipes: pipesOf(args, RouteParamtypes.BODY),
          queryPipes: pipesOf(args, RouteParamtypes.QUERY),
        });
      }
    }
    return routes;
  } finally {
    await moduleRef.close();
  }
}
