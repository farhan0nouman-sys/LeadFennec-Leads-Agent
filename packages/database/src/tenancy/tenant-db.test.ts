import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import {
  isTenantModel,
  PLATFORM_MODELS,
  scopeTenantArgs,
  TENANT_MODELS,
  TenantScopeError,
} from './tenant-db.js';

// The argument rules of the tenant-scoped client. The integration suite
// (tenant-access.integration.test.ts) runs them against every model on PostgreSQL.
const own = '00000000-0000-4000-8000-a00000000001';
const other = '00000000-0000-4000-8000-b00000000001';
const rw = { readOnly: false };
const ro = { readOnly: true };

describe('model registry', () => {
  it('splits every Prisma model into platform and tenant-owned', () => {
    const all = Object.values(Prisma.ModelName);
    expect([...PLATFORM_MODELS, ...TENANT_MODELS].sort()).toEqual(
      [...all].sort(),
    );
    expect(TENANT_MODELS).toHaveLength(43);
    expect(isTenantModel('Contact')).toBe(true);
    expect(isTenantModel('User')).toBe(false);
    expect(isTenantModel('NoSuchModel')).toBe(false);
  });
});

describe('scopeTenantArgs', () => {
  it.each([
    'findUnique',
    'findUniqueOrThrow',
    'findFirst',
    'findFirstOrThrow',
    'findMany',
    'count',
    'aggregate',
    'groupBy',
  ])('adds the tenant filter to %s', (operation) => {
    expect(
      scopeTenantArgs(operation, { where: { status: 'ACTIVE' } }, own, ro),
    ).toEqual({ where: { status: 'ACTIVE', tenantId: own } });
  });

  it('scopes calls without arguments', () => {
    expect(scopeTenantArgs('findMany', undefined, own, rw)).toEqual({
      where: { tenantId: own },
    });
  });

  it('accepts its own tenant and rejects another, also inside compound keys', () => {
    expect(
      scopeTenantArgs(
        'findUnique',
        { where: { tenantId_id: { tenantId: own, id: own } } },
        own,
        rw,
      ),
    ).toEqual({
      where: { tenantId_id: { tenantId: own, id: own }, tenantId: own },
    });
    expect(() =>
      scopeTenantArgs('findMany', { where: { tenantId: other } }, own, rw),
    ).toThrow(TenantScopeError);
    expect(() =>
      scopeTenantArgs(
        'findUnique',
        { where: { tenantId_id: { tenantId: other, id: own } } },
        own,
        rw,
      ),
    ).toThrow(TenantScopeError);
    // Filters on tenantId other than plain equality are not needed and not allowed.
    expect(() =>
      scopeTenantArgs(
        'findMany',
        { where: { tenantId: { in: [own, other] } } },
        own,
        rw,
      ),
    ).toThrow(TenantScopeError);
  });

  it('keeps OR/AND/NOT under the tenant filter', () => {
    const scoped = scopeTenantArgs(
      'findMany',
      { where: { OR: [{ status: 'A' }, { status: 'B' }] } },
      own,
      rw,
    );
    expect(scoped).toEqual({
      where: { OR: [{ status: 'A' }, { status: 'B' }], tenantId: own },
    });
  });

  it('sets the tenant on creates and rejects another tenant', () => {
    expect(scopeTenantArgs('create', { data: { name: 'x' } }, own, rw)).toEqual(
      {
        data: { name: 'x', tenantId: own },
      },
    );
    expect(
      scopeTenantArgs(
        'createMany',
        { data: [{ name: 'x' }, { name: 'y', tenantId: own }] },
        own,
        rw,
      ),
    ).toEqual({
      data: [
        { name: 'x', tenantId: own },
        { name: 'y', tenantId: own },
      ],
    });
    expect(() =>
      scopeTenantArgs(
        'createMany',
        { data: [{ name: 'x' }, { tenantId: other }] },
        own,
        rw,
      ),
    ).toThrow(TenantScopeError);
    expect(() =>
      scopeTenantArgs(
        'create',
        { data: { tenant: { connect: { id: other } } } },
        own,
        rw,
      ),
    ).toThrow(TenantScopeError);
  });

  it('scopes updates and deletes and forbids moving rows', () => {
    expect(
      scopeTenantArgs(
        'updateMany',
        { where: { id: own }, data: { name: 'x' } },
        own,
        rw,
      ),
    ).toEqual({ where: { id: own, tenantId: own }, data: { name: 'x' } });
    expect(scopeTenantArgs('deleteMany', {}, own, rw)).toEqual({
      where: { tenantId: own },
    });
    expect(() =>
      scopeTenantArgs(
        'update',
        { where: { id: own }, data: { tenantId: other } },
        own,
        rw,
      ),
    ).toThrow(TenantScopeError);
  });

  it('scopes upserts on both sides', () => {
    expect(
      scopeTenantArgs(
        'upsert',
        { where: { id: own }, create: { name: 'x' }, update: { name: 'y' } },
        own,
        rw,
      ),
    ).toEqual({
      where: { id: own, tenantId: own },
      create: { name: 'x', tenantId: own },
      update: { name: 'y' },
    });
    expect(() =>
      scopeTenantArgs(
        'upsert',
        { where: { id: own }, create: { tenantId: other }, update: {} },
        own,
        rw,
      ),
    ).toThrow(TenantScopeError);
  });

  it.each([
    'create',
    'createMany',
    'update',
    'updateMany',
    'upsert',
    'delete',
    'deleteMany',
  ])('rejects %s in a read-only scope', (operation) => {
    expect(() =>
      scopeTenantArgs(operation, { where: {}, data: {} }, own, ro),
    ).toThrow(/read-only/);
  });

  it('fails closed on unknown operations and malformed arguments', () => {
    expect(() => scopeTenantArgs('findRaw', {}, own, rw)).toThrow(
      TenantScopeError,
    );
    expect(() => scopeTenantArgs('findMany', 'where', own, rw)).toThrow(
      TenantScopeError,
    );
    expect(() => scopeTenantArgs('findMany', { where: [] }, own, rw)).toThrow(
      TenantScopeError,
    );
  });
});
