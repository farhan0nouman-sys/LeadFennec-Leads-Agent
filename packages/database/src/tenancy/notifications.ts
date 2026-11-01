// In-app notifications to members (docs/decisions.md D-03C-01). A member sees and marks only
// their own notifications.
import { z } from 'zod';
import type { Notification, PrismaClient } from '../generated/prisma/client.js';
import { paginate, type Page, type PageRequest } from '../pagination.js';
import {
  ActorNotAllowedError,
  dottedKeySchema,
  uuidSchema,
  type MemberActor,
  type TenantActor,
} from './actors.js';

const notifySchema = z
  .object({
    recipientMembershipId: uuidSchema,
    type: dottedKeySchema,
    title: z.string().min(1).max(200),
    body: z.string().max(2000).optional(),
    /** A path inside the app; never an external or protocol-relative URL. */
    linkPath: z
      .string()
      .max(500)
      .regex(/^\/([^/\\\s]\S*)?$/)
      .optional(),
    dedupeKey: z.string().min(1).max(200).optional(),
  })
  .strict();

export type NotifyInput = z.input<typeof notifySchema>;

export interface NotificationRepository {
  /**
   * Creates a notification; with a dedupeKey, a repeated call returns the existing one. System
   * actor only.
   */
  notify(input: NotifyInput): Promise<Notification>;
  /** The acting member's notifications, newest first. */
  listMine(page: PageRequest): Promise<Page<Notification>>;
  unreadCount(): Promise<number>;
  /** Marks one of the acting member's notifications read; false if there is no such unread one. */
  markRead(notificationId: string): Promise<boolean>;
}

export function createNotificationRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): NotificationRepository {
  const member = (operation: string): MemberActor => {
    if (actor.kind !== 'member') {
      throw new ActorNotAllowedError(operation);
    }
    return actor;
  };

  return {
    async notify(input) {
      // Application code notifies (system actor); a member's scope cannot write messages to
      // other members (task 04C, D-04C-04).
      if (actor.kind !== 'system') {
        throw new ActorNotAllowedError('notifications.notify');
      }
      const parsed = notifySchema.parse(input);
      const data = {
        tenantId,
        recipientMembershipId: parsed.recipientMembershipId,
        type: parsed.type,
        title: parsed.title,
        body: parsed.body ?? null,
        linkPath: parsed.linkPath ?? null,
        dedupeKey: parsed.dedupeKey ?? null,
        createdAt: now(),
      };
      if (parsed.dedupeKey === undefined) {
        return prisma.notification.create({ data });
      }
      await prisma.notification.createMany({
        data: [data],
        skipDuplicates: true,
      });
      return prisma.notification.findUniqueOrThrow({
        where: {
          tenantId_recipientMembershipId_dedupeKey: {
            tenantId,
            recipientMembershipId: parsed.recipientMembershipId,
            dedupeKey: parsed.dedupeKey,
          },
        },
      });
    },
    async listMine(page) {
      const { membershipId } = member('notifications.listMine');
      return paginate(page, (keyset) =>
        prisma.notification.findMany({
          where: {
            tenantId,
            recipientMembershipId: membershipId,
            ...keyset.cursorWhere,
          },
          orderBy: keyset.orderBy,
          take: keyset.take,
        }),
      );
    },
    async unreadCount() {
      const { membershipId } = member('notifications.unreadCount');
      return prisma.notification.count({
        where: { tenantId, recipientMembershipId: membershipId, readAt: null },
      });
    },
    async markRead(notificationId) {
      const { membershipId } = member('notifications.markRead');
      const { count } = await prisma.notification.updateMany({
        where: {
          tenantId,
          id: uuidSchema.parse(notificationId),
          recipientMembershipId: membershipId,
          readAt: null,
        },
        data: { readAt: now() },
      });
      return count === 1;
    },
  };
}
