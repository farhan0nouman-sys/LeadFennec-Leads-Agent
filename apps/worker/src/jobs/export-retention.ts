// The export retention sweep (task 11C, docs/security/data-retention.md): lead files can be
// downloaded for EXPORT_LIMITS.ttlHours, then their content is deleted. Every workspace is
// visited (active or not: a suspended workspace's files expire too), and each one's files are
// purged through its own system scope, so every query stays tenant-scoped. Downloads refuse an
// expired file even before the sweep reaches it.
import { systemScope, type PrismaClient } from '@lead-fennec-ai/database';

/** How often the worker sweeps (the download refuses expired files in between). */
export const EXPORT_RETENTION_INTERVAL_MS = 15 * 60 * 1000;

const PAGE = 200;

/** Deletes the content of every expired lead file; returns how many files were purged. */
export async function purgeExpiredExports(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): Promise<number> {
  let purged = 0;
  let after: string | undefined;
  for (;;) {
    const tenants = await prisma.tenant.findMany({
      where: after === undefined ? {} : { id: { gt: after } },
      orderBy: { id: 'asc' },
      take: PAGE,
      select: { id: true },
    });
    for (const { id } of tenants) {
      const scope = systemScope(
        prisma,
        { tenantId: id, name: 'export_retention' },
        { now },
      );
      purged += await scope.exports.purgeExpired();
    }
    if (tenants.length < PAGE) {
      return purged;
    }
    after = tenants.at(-1)?.id;
  }
}
