// Fixture factories (docs/decisions.md D-03C-07): rows with valid defaults for tests and local
// experiments, next to the two static fixture tenants. Every call creates fresh ids and unique
// names (reserved .test domains), so a test can create as many tenants as it needs without
// touching the fixture tenants. Overrides replace any default.
import { randomUUID } from 'node:crypto';
import { normalizeEmail } from '@lead-fennec-ai/shared';
import type {
  BillingPlan,
  Contact,
  Membership,
  Prisma,
  PrismaClient,
  Role,
  Subscription,
  Tenant,
  UsageMetric,
  User,
} from '../generated/prisma/client.js';
import { FIXTURE_PERMISSIONS } from './fixture-data.js';

export interface FactoryTenant {
  readonly tenant: Tenant;
  /** "client_admin" with every catalog permission. */
  readonly adminRole: Role;
  /** "client_member" without permissions. */
  readonly memberRole: Role;
}

export interface FactoryWorkspace extends FactoryTenant {
  readonly admin: User;
  readonly adminMembership: Membership;
  readonly plan: BillingPlan;
  readonly subscription: Subscription;
}

type Overrides<T> = Partial<Omit<T, 'tenantId'>>;

/** The UTC calendar month containing `at`: [first day, first day of next month). */
export function calendarMonth(at: Date): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
    end: new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)),
  };
}

export function createFixtureFactory(prisma: PrismaClient) {
  let sequence = 0;
  const unique = () => {
    sequence += 1;
    return `${String(sequence)}-${randomUUID().slice(0, 8)}`;
  };

  const factory = {
    async user(
      overrides: Partial<Prisma.UserCreateManyInput> = {},
    ): Promise<User> {
      const email = overrides.email ?? `user-${unique()}@factory.test`;
      return prisma.user.create({
        data: {
          email,
          normalizedEmail: normalizeEmail(email).email,
          displayName: 'Factory User',
          ...overrides,
        },
      });
    },

    /** A tenant with settings and the two system roles. */
    async tenant(
      overrides: Partial<Prisma.TenantCreateManyInput> = {},
    ): Promise<FactoryTenant> {
      const slug = `factory-${unique()}`;
      return prisma.$transaction(async (tx) => {
        await tx.permission.createMany({
          data: [...FIXTURE_PERMISSIONS],
          skipDuplicates: true,
        });
        const tenant = await tx.tenant.create({
          data: { slug, name: `Factory tenant ${slug}`, ...overrides },
        });
        const tenantId = tenant.id;
        await tx.tenantSettings.create({ data: { tenantId } });
        const adminRole = await tx.role.create({
          data: {
            tenantId,
            key: 'client_admin',
            name: 'Client Admin',
            isSystem: true,
          },
        });
        const memberRole = await tx.role.create({
          data: {
            tenantId,
            key: 'client_member',
            name: 'Client Team Member',
            isSystem: true,
          },
        });
        await tx.rolePermission.createMany({
          data: FIXTURE_PERMISSIONS.map((p) => ({
            tenantId,
            roleId: adminRole.id,
            permissionKey: p.key,
          })),
        });
        return { tenant, adminRole, memberRole };
      });
    },

    async membership(
      input: Pick<
        Prisma.MembershipCreateManyInput,
        'tenantId' | 'userId' | 'roleId'
      > &
        Overrides<Prisma.MembershipCreateManyInput>,
    ): Promise<Membership> {
      return prisma.membership.create({ data: { status: 'ACTIVE', ...input } });
    },

    /** A MANUAL-billed plan; a metric missing from `limits` is not included. */
    async plan(
      limits: Partial<Record<UsageMetric, bigint>> = {},
      overrides: Partial<Prisma.BillingPlanCreateManyInput> = {},
    ): Promise<BillingPlan> {
      const key = `factory_${unique().replace('-', '_')}`;
      return prisma.billingPlan.create({
        data: {
          key,
          name: `Factory plan ${key}`,
          currency: 'USD',
          amountMinor: 1_000n,
          interval: 'MONTH',
          ...overrides,
          limits: {
            create: Object.entries(limits).map(
              ([metric, quantityPerPeriod]) => ({
                metric: metric as UsageMetric,
                quantityPerPeriod,
              }),
            ),
          },
        },
      });
    },

    /** An ACTIVE MANUAL subscription for the current UTC calendar month. */
    async subscription(
      input: Pick<Prisma.SubscriptionCreateManyInput, 'tenantId' | 'planId'> &
        Overrides<Prisma.SubscriptionCreateManyInput>,
    ): Promise<Subscription> {
      const { start, end } = calendarMonth(new Date());
      return prisma.subscription.create({
        data: {
          provider: 'MANUAL',
          status: 'ACTIVE',
          currentPeriodStart: start,
          currentPeriodEnd: end,
          ...input,
        },
      });
    },

    async contact(
      input: Pick<Prisma.ContactCreateManyInput, 'tenantId'> &
        Overrides<Prisma.ContactCreateManyInput>,
    ): Promise<Contact> {
      const email = `contact-${unique()}@factory-prospect.test`;
      const identity = normalizeEmail(email);
      return prisma.contact.create({
        data: {
          firstName: 'Factory',
          lastName: 'Contact',
          email,
          normalizedEmail: identity.email,
          emailDomain: identity.domain,
          ...input,
        },
      });
    },

    /**
     * A tenant with an ACTIVE admin member and an ACTIVE subscription to a new plan with these
     * limits: the usual starting point for repository tests.
     */
    async workspace(
      limits: Partial<Record<UsageMetric, bigint>> = {},
    ): Promise<FactoryWorkspace> {
      const base = await factory.tenant();
      const admin = await factory.user();
      const adminMembership = await factory.membership({
        tenantId: base.tenant.id,
        userId: admin.id,
        roleId: base.adminRole.id,
      });
      const plan = await factory.plan(limits);
      const subscription = await factory.subscription({
        tenantId: base.tenant.id,
        planId: plan.id,
      });
      return { ...base, admin, adminMembership, plan, subscription };
    },
  };
  return factory;
}

export type FixtureFactory = ReturnType<typeof createFixtureFactory>;
