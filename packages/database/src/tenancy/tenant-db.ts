// A Prisma Client that can only touch one tenant's rows (docs/decisions.md D-03C-04).
//
// Every operation on a tenant-owned model gets `tenant_id = <scope>` added to its where, and
// every create gets the scope's tenant id. Arguments that name another tenant are rejected
// before anything reaches the database. Platform models and raw SQL are not available.
// Nested writes are allowed: every relation between tenant rows includes tenant_id (composite
// foreign keys) and tenant_id is immutable, so they cannot cross tenants either.
// Prisma's types still ask for tenantId on creates: pass db.tenantId (any other value is rejected).
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';

/** Models without tenant_id (platform scope). Every other model is tenant-owned. */
export const PLATFORM_MODELS = [
  'Tenant',
  'User',
  'Permission',
  'BillingPlan',
  'PlanLimit',
  'PlatformAuditRecord',
  'UserCredential',
  'UserSession',
  'AuthToken',
  'AuthThrottle',
] as const satisfies readonly Prisma.ModelName[];

export type PlatformModelName = (typeof PLATFORM_MODELS)[number];
export type TenantModelName = Exclude<Prisma.ModelName, PlatformModelName>;

const platformModels: ReadonlySet<string> = new Set(PLATFORM_MODELS);

export function isTenantModel(model: string): model is TenantModelName {
  return (
    !platformModels.has(model) &&
    (Object.values(Prisma.ModelName) as string[]).includes(model)
  );
}

export const TENANT_MODELS: readonly TenantModelName[] = Object.values(
  Prisma.ModelName,
).filter(isTenantModel);

/** A tenant scope was asked to do something outside it. Never retried. */
export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);
const FILTERED_WRITE_OPERATIONS = new Set([
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);
const CREATE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
]);

type Args = Record<string, unknown>;

function isPlainObject(value: unknown): value is Args {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function objectArg(value: unknown, name: string): Args {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new TenantScopeError(`${name} must be an object`);
  }
  return value;
}

/** Adds the tenant filter. Rejects a where that names another tenant, also inside compound keys. */
function scopeWhere(where: unknown, tenantId: string): Args {
  const scoped = objectArg(where, 'where');
  for (const [key, value] of Object.entries(scoped)) {
    if (key === 'tenantId') {
      if (value !== tenantId) {
        throw new TenantScopeError('where names another tenant');
      }
    } else if (isPlainObject(value) && 'tenantId' in value) {
      // Compound unique keys such as tenantId_id.
      if (value['tenantId'] !== tenantId) {
        throw new TenantScopeError(`where.${key} names another tenant`);
      }
    }
  }
  return { ...scoped, tenantId };
}

/** Checks write data: the tenant can be omitted or repeated, never changed. */
function checkData(data: unknown, tenantId: string, name: string): Args {
  const checked = objectArg(data, name);
  if ('tenant' in checked) {
    throw new TenantScopeError(
      `${name}.tenant is not allowed; the scope sets tenantId`,
    );
  }
  if ('tenantId' in checked && checked['tenantId'] !== tenantId) {
    throw new TenantScopeError(`${name} names another tenant`);
  }
  return checked;
}

function scopeCreateData(data: unknown, tenantId: string, name: string): Args {
  return { ...checkData(data, tenantId, name), tenantId };
}

export interface TenantScopeOptions {
  /** Reject every write (platform-admin access is read-only, D-03C-05). */
  readonly readOnly: boolean;
}

/**
 * Returns the arguments of one model operation restricted to `tenantId`. Exported for unit
 * tests; the tenant client applies it to every operation.
 */
export function scopeTenantArgs(
  operation: string,
  args: unknown,
  tenantId: string,
  options: TenantScopeOptions,
): Args {
  const input = objectArg(args, 'arguments');
  if (READ_OPERATIONS.has(operation)) {
    return { ...input, where: scopeWhere(input['where'], tenantId) };
  }
  if (options.readOnly) {
    throw new TenantScopeError(
      `${operation} is not allowed: this scope is read-only`,
    );
  }
  if (FILTERED_WRITE_OPERATIONS.has(operation)) {
    const scoped: Args = {
      ...input,
      where: scopeWhere(input['where'], tenantId),
    };
    if ('data' in input) {
      checkData(input['data'], tenantId, 'data');
    }
    return scoped;
  }
  if (CREATE_OPERATIONS.has(operation)) {
    const data = input['data'];
    return {
      ...input,
      data: Array.isArray(data)
        ? data.map((row, i) =>
            scopeCreateData(row, tenantId, `data[${String(i)}]`),
          )
        : scopeCreateData(data, tenantId, 'data'),
    };
  }
  if (operation === 'upsert') {
    checkData(input['update'], tenantId, 'update');
    return {
      ...input,
      where: scopeWhere(input['where'], tenantId),
      create: scopeCreateData(input['create'], tenantId, 'create'),
    };
  }
  // Fail closed on operations this scope does not know.
  throw new TenantScopeError(`${operation} is not available in a tenant scope`);
}

function extendForTenant(
  prisma: PrismaClient,
  tenantId: string,
  options: TenantScopeOptions,
) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (model === undefined) {
          throw new TenantScopeError(
            `${operation} is not available in a tenant scope`,
          );
        }
        if (!isTenantModel(model)) {
          throw new TenantScopeError(
            `${model} is platform data, not available in a tenant scope`,
          );
        }
        const result: unknown = await query(
          scopeTenantArgs(operation, args, tenantId, options),
        );
        return result;
      },
    },
  });
}

type ExtendedClient = ReturnType<typeof extendForTenant>;
type TenantDelegateKey = Uncapitalize<TenantModelName>;

/** Tenant-owned model delegates plus transactions; no platform models, no raw SQL. */
export interface TenantDb extends Pick<ExtendedClient, TenantDelegateKey> {
  readonly tenantId: string;
  /** An interactive transaction whose client has the same scope. */
  $transaction<R>(
    fn: (tx: TenantDb) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R>;
}

/** Wraps a scoped client (or transaction client) so that only the TenantDb surface is visible. */
function asTenantDb(client: ExtendedClient, tenantId: string): TenantDb {
  return new Proxy(client, {
    get(target, property) {
      if (property === 'tenantId') {
        return tenantId;
      }
      if (property === '$transaction') {
        return <R>(
          fn: (tx: TenantDb) => Promise<R>,
          options?: { maxWait?: number; timeout?: number },
        ): Promise<R> =>
          target.$transaction(
            (tx) => fn(asTenantDb(tx as unknown as ExtendedClient, tenantId)),
            options,
          );
      }
      if (typeof property === 'string' && property.startsWith('$')) {
        throw new TenantScopeError(
          `${property} is not available in a tenant scope`,
        );
      }
      // The client itself as receiver: Prisma's getters must not see the proxy.
      return Reflect.get(target, property) as unknown;
    },
  }) as unknown as TenantDb;
}

/**
 * A client restricted to one tenant. Obtain it through the access entry points
 * (tenancy/access.ts), which decide who may use which tenant.
 */
export function createTenantDb(
  prisma: PrismaClient,
  tenantId: string,
  options: TenantScopeOptions = { readOnly: false },
): TenantDb {
  return asTenantDb(extendForTenant(prisma, tenantId, options), tenantId);
}
