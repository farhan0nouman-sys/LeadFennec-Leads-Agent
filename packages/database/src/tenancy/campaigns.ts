// Campaign configuration (task 06A, docs/decisions.md D-06A-*): drafts saved section by
// section with a version check, references checked against the scope's workspace even while
// the draft is incomplete, and duplication that copies configuration only. Every query filters
// by tenantId; reads need campaigns.read, changes campaigns.write. Since 06C: readiness checks
// and the explicit activation, the only way a campaign starts.
import {
  activateCampaignRequestSchema,
  BUILT_SERVICES,
  evaluateActivation,
  type ActivationFacts,
  type ActivationReport,
  type CampaignServices,
  audienceFiltersSchema,
  businessProfileSchema,
  campaignReadiness,
  CAMPAIGN_SECTIONS,
  createCampaignRequestSchema,
  DEFAULT_EXCLUSIONS,
  DEFAULT_LEAD_SCORING_CONFIG,
  duplicateCampaignRequestSchema,
  exclusionsSchema,
  leadScoringConfigSchema,
  offerSchema,
  updateCampaignRequestSchema,
  CAMPAIGN_OPTIONS_LIMIT,
  type CampaignListItem,
  type CampaignOptions,
  type Campaign as CampaignContract,
} from '@lead-fennec-ai/shared';
import type { z } from 'zod';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { paginate, type Page, type PageRequest } from '../pagination.js';
import { uuidSchema, type TenantActor } from './actors.js';
import { writeAuditRecord, type DbClient } from './audit.js';
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  findCurrentSubscription,
  findEffectiveLimit,
} from './billing.js';
import {
  RecordNotFoundError,
  requirePermission,
  requireReadPermission,
} from './authorization.js';

/** The save started from an older version than the stored one. */
export class CampaignVersionConflictError extends Error {
  constructor() {
    super('The campaign changed since this version');
    this.name = 'CampaignVersionConflictError';
  }
}

/** Only DRAFT campaigns can be configured. */
export class CampaignNotEditableError extends Error {
  constructor() {
    super('Only draft campaigns can be changed');
    this.name = 'CampaignNotEditableError';
  }
}

/** A check blocks starting the campaign; `report` has every check and its reasons. */
export class CampaignNotReadyError extends Error {
  constructor(readonly report: ActivationReport) {
    super('The campaign is not ready to start');
    this.name = 'CampaignNotReadyError';
  }
}

/** Another campaign of the workspace has this name. */
export class CampaignNameTakenError extends Error {
  constructor() {
    super('Another campaign has this name');
    this.name = 'CampaignNameTakenError';
  }
}

/**
 * Values that are well-formed but not allowed here: a reference that is not a record of this
 * workspace (or not usable), or a setting the workspace forbids. `issues` name the fields.
 */
export class CampaignConfigurationError extends Error {
  constructor(readonly issues: readonly { path: string; message: string }[]) {
    super('The campaign configuration is not allowed');
    this.name = 'CampaignConfigurationError';
  }
}

/** A campaign as the contract describes it, with Date timestamps. */
export type CampaignConfig = Omit<
  CampaignContract,
  'createdAt' | 'updatedAt'
> & {
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type CampaignSummary = Omit<CampaignListItem, 'updatedAt'> & {
  readonly updatedAt: Date;
};

export interface CampaignRepository {
  /**
   * The records a save may reference, by name (campaigns.read): ICPs and lead lists that
   * aren't archived, mailboxes that aren't disconnected, active templates.
   */
  options(): Promise<CampaignOptions>;
  /** Newest first (campaigns.read). */
  list(page: PageRequest): Promise<Page<CampaignSummary>>;
  /** One campaign's configuration (campaigns.read). */
  get(campaignId: string): Promise<CampaignConfig>;
  /** A DRAFT with human approval and the workspace's time zone (campaigns.write). */
  create(
    input: z.input<typeof createCampaignRequestSchema>,
  ): Promise<CampaignConfig>;
  /**
   * Saves the sections in `input` if `input.version` is the stored version and the campaign is
   * a DRAFT (campaigns.write; AUTOMATIC approval also needs drafts.approve).
   */
  update(
    campaignId: string,
    input: z.input<typeof updateCampaignRequestSchema>,
  ): Promise<CampaignConfig>;
  /**
   * A new DRAFT with the configuration and sequences of `campaignId`, never its leads, drafts,
   * approvals, sends or schedules. Approval starts over as HUMAN (campaigns.write).
   */
  duplicate(
    campaignId: string,
    input: z.input<typeof duplicateCampaignRequestSchema>,
  ): Promise<CampaignConfig>;
  /**
   * Every activation check, with reasons (campaigns.read). `services`: the later services that
   * exist; production passes BUILT_SERVICES (none), so activation fails closed.
   */
  readiness(
    campaignId: string,
    services?: CampaignServices,
  ): Promise<ActivationReport>;
  /**
   * Starts a DRAFT if `input.version` is the stored version and every check passes
   * (campaigns.write; AUTOMATIC approval also needs drafts.approve). The version doesn't
   * change, so repeating the same request returns the running campaign unchanged.
   */
  activate(
    campaignId: string,
    input: z.input<typeof activateCampaignRequestSchema>,
    services?: CampaignServices,
  ): Promise<CampaignConfig>;
}

/** The sequence the configuration edits: the campaign's oldest. */
const PRIMARY_SEQUENCE = {
  orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  take: 1,
};

const CAMPAIGN_INCLUDE = {
  sequences: {
    ...PRIMARY_SEQUENCE,
    include: { steps: { orderBy: { position: 'asc' as const } } },
  },
} satisfies Prisma.CampaignInclude;

type CampaignRow = Prisma.CampaignGetPayload<{
  include: typeof CAMPAIGN_INCLUDE;
}>;

/** A section for a Json? column: SQL NULL for none. */
const json = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  value ?? Prisma.DbNull;

/** Stored sections are validated again when read: never trust a column to be well-formed. */
function toConfig(row: CampaignRow): CampaignConfig {
  const steps = (row.sequences[0]?.steps ?? []).map((step) => ({
    id: step.id,
    position: step.position,
    delayMinutes: step.delayMinutes,
    templateId: step.templateId,
  }));
  const shaped = {
    businessProfile: businessProfileSchema
      .nullable()
      .parse(row.businessProfile),
    offer: offerSchema.nullable().parse(row.offer),
    audience: {
      icpId: row.icpId,
      leadListId: row.leadListId,
      filters: audienceFiltersSchema.parse(row.audienceFilters ?? {}),
    },
    leadLimits: {
      dailyNewLeads: row.dailyNewLeadLimit,
      maxLeads: row.maxLeads,
    },
    sender: { emailAccountId: row.emailAccountId },
  };
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    approvalMode: row.approvalMode,
    ...shaped,
    exclusions: exclusionsSchema.parse(row.exclusions ?? DEFAULT_EXCLUSIONS),
    timezone: row.timezone,
    schedule: {
      weekdays: row.sendWeekdays,
      windowStartMinute: row.sendWindowStartMinute,
      windowEndMinute: row.sendWindowEndMinute,
    },
    sequence: { steps },
    scoring:
      row.scoring === null
        ? {
            custom: false,
            config: structuredClone(DEFAULT_LEAD_SCORING_CONFIG),
          }
        : { custom: true, config: leadScoringConfigSchema.parse(row.scoring) },
    readiness: campaignReadiness({ ...shaped, stepCount: steps.length }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A malformed id is simply not a campaign of this workspace. */
function campaignIdOf(raw: string): string {
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RecordNotFoundError('campaign');
  }
  return parsed.data;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

const NOT_FOUND = 'Not found in this workspace.';

export function createCampaignRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date = () => new Date(),
): CampaignRepository {
  /** What the activation checks look at, read in the caller's transaction. */
  async function gatherFacts(
    db: DbClient,
    campaign: CampaignConfig,
  ): Promise<ActivationFacts> {
    const { icpId, leadListId } = campaign.audience;
    const emailAccountId = campaign.sender.emailAccountId;
    const templateIds = [
      ...new Set(
        campaign.sequence.steps.flatMap((step) => step.templateId ?? []),
      ),
    ];
    const icp =
      icpId === null
        ? null
        : await db.icp.findUnique({
            where: { tenantId_id: { tenantId, id: icpId } },
            select: { status: true },
          });
    const list =
      leadListId === null
        ? null
        : await db.leadList.findUnique({
            where: { tenantId_id: { tenantId, id: leadListId } },
            select: { status: true },
          });
    const contactsWithEmail =
      list === null || leadListId === null
        ? 0
        : await db.leadListMember.count({
            where: {
              tenantId,
              leadListId,
              contact: { status: 'ACTIVE', normalizedEmail: { not: null } },
            },
          });
    const mailbox =
      emailAccountId === null
        ? null
        : await db.emailAccount.findUnique({
            where: { tenantId_id: { tenantId, id: emailAccountId } },
            select: { status: true, secretRef: true, dailySendLimit: true },
          });
    const failingSyncs =
      emailAccountId === null
        ? 0
        : await db.integrationSyncCursor.count({
            where: { tenantId, emailAccountId, consecutiveFailures: { gt: 0 } },
          });
    const templates =
      templateIds.length === 0
        ? []
        : await db.template.findMany({
            where: { tenantId, id: { in: templateIds } },
            select: { id: true, status: true },
          });
    // Active members of active accounts whose role grants drafts.approve.
    const approvers = await db.membership.count({
      where: {
        tenantId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        role: { permissions: { some: { permissionKey: 'drafts.approve' } } },
      },
    });
    const settings = await db.tenantSettings.findUnique({
      where: { tenantId },
      select: { requireSendApproval: true, outboundSendingEnabled: true },
    });
    const subscription = await findCurrentSubscription(db, tenantId);
    const emailsPerPeriod =
      subscription === null
        ? 0n
        : await findEffectiveLimit(
            db,
            tenantId,
            subscription.planId,
            'EMAILS_SENT',
          );
    return {
      campaign,
      icp,
      leadList:
        list === null ? null : { status: list.status, contactsWithEmail },
      mailbox:
        mailbox === null
          ? null
          : {
              status: mailbox.status,
              hasCredentials: mailbox.secretRef !== null,
              dailySendLimit: mailbox.dailySendLimit,
              failingSyncs,
            },
      templates: Object.fromEntries(templates.map((t) => [t.id, t.status])),
      approvers,
      // No settings row: the safe defaults (approval required, sending off).
      workspace: {
        requireSendApproval: settings?.requireSendApproval ?? true,
        outboundSendingEnabled: settings?.outboundSendingEnabled ?? false,
      },
      plan:
        subscription === null
          ? null
          : {
              entitled: (
                ENTITLED_SUBSCRIPTION_STATUSES as readonly string[]
              ).includes(subscription.status),
              emailsPerPeriod: Number(emailsPerPeriod),
            },
    };
  }

  async function load(db: DbClient, campaignId: string) {
    const row = await db.campaign.findUnique({
      where: { tenantId_id: { tenantId, id: campaignId } },
      include: CAMPAIGN_INCLUDE,
    });
    if (row === null) {
      throw new RecordNotFoundError('campaign');
    }
    return toConfig(row);
  }

  /**
   * Every id the save references must be a usable record of this workspace. All problems are
   * reported together; another workspace's record reads as "not found", like a missing one.
   */
  async function checkReferences(
    db: DbClient,
    input: z.output<typeof updateCampaignRequestSchema>,
  ): Promise<void> {
    const issues: { path: string; message: string }[] = [];
    const icpId = input.audience?.icpId;
    if (icpId != null) {
      const icp = await db.icp.findUnique({
        where: { tenantId_id: { tenantId, id: icpId } },
        select: { status: true },
      });
      if (icp === null) {
        issues.push({ path: 'audience.icpId', message: NOT_FOUND });
      } else if (icp.status === 'ARCHIVED') {
        issues.push({
          path: 'audience.icpId',
          message: 'This ideal customer profile is archived.',
        });
      }
    }
    const leadListIds = [
      ...(input.audience?.leadListId == null
        ? []
        : [input.audience.leadListId]),
      ...(input.exclusions?.leadListIds ?? []),
    ];
    if (leadListIds.length > 0) {
      const lists = await db.leadList.findMany({
        where: { tenantId, id: { in: leadListIds } },
        select: { id: true, status: true },
      });
      const found = new Map(lists.map((list) => [list.id, list.status]));
      const leadListId = input.audience?.leadListId;
      if (leadListId != null) {
        const status = found.get(leadListId);
        if (status === undefined) {
          issues.push({ path: 'audience.leadListId', message: NOT_FOUND });
        } else if (status === 'ARCHIVED') {
          issues.push({
            path: 'audience.leadListId',
            message: 'This lead list is archived.',
          });
        }
      }
      (input.exclusions?.leadListIds ?? []).forEach((id, index) => {
        if (!found.has(id)) {
          issues.push({
            path: `exclusions.leadListIds.${String(index)}`,
            message: NOT_FOUND,
          });
        }
      });
    }
    const emailAccountId = input.sender?.emailAccountId;
    if (emailAccountId != null) {
      const mailbox = await db.emailAccount.findUnique({
        where: { tenantId_id: { tenantId, id: emailAccountId } },
        select: { status: true },
      });
      if (mailbox === null) {
        issues.push({ path: 'sender.emailAccountId', message: NOT_FOUND });
      } else if (mailbox.status === 'DISCONNECTED') {
        issues.push({
          path: 'sender.emailAccountId',
          message: 'This mailbox is disconnected.',
        });
      }
    }
    const steps = input.sequence?.steps ?? [];
    const templateIds = [
      ...new Set(steps.flatMap((step) => step.templateId ?? [])),
    ];
    if (templateIds.length > 0) {
      const templates = await db.template.findMany({
        where: { tenantId, id: { in: templateIds } },
        select: { id: true, status: true },
      });
      const found = new Map(templates.map((t) => [t.id, t.status]));
      steps.forEach((step, index) => {
        if (step.templateId == null) {
          return;
        }
        const status = found.get(step.templateId);
        if (status !== 'ACTIVE') {
          issues.push({
            path: `sequence.steps.${String(index)}.templateId`,
            message:
              status === undefined ? NOT_FOUND : 'This template is archived.',
          });
        }
      });
    }
    if (input.approvalMode === 'AUTOMATIC') {
      const settings = await db.tenantSettings.findUnique({
        where: { tenantId },
        select: { requireSendApproval: true },
      });
      // No settings row: the safe default (approval required) applies.
      if (settings?.requireSendApproval !== false) {
        issues.push({
          path: 'approvalMode',
          message: 'This workspace requires a person to approve every message.',
        });
      }
    }
    if (issues.length > 0) {
      throw new CampaignConfigurationError(issues);
    }
  }

  /** The columns a save changes. */
  function changes(
    input: z.output<typeof updateCampaignRequestSchema>,
  ): Prisma.CampaignUncheckedUpdateManyInput {
    const data: Prisma.CampaignUncheckedUpdateManyInput = {};
    if (input.name !== undefined) {
      data.name = input.name;
    }
    if (input.description !== undefined) {
      data.description = input.description;
    }
    if (input.businessProfile !== undefined) {
      data.businessProfile = json(input.businessProfile);
    }
    if (input.offer !== undefined) {
      data.offer = json(input.offer);
    }
    if (input.audience !== undefined) {
      data.icpId = input.audience.icpId ?? null;
      data.leadListId = input.audience.leadListId ?? null;
      data.audienceFilters = json(input.audience.filters ?? {});
    }
    if (input.exclusions !== undefined) {
      data.exclusions = json({ ...DEFAULT_EXCLUSIONS, ...input.exclusions });
    }
    if (input.leadLimits !== undefined) {
      data.dailyNewLeadLimit = input.leadLimits.dailyNewLeads ?? null;
      data.maxLeads = input.leadLimits.maxLeads ?? null;
    }
    if (input.timezone !== undefined) {
      data.timezone = input.timezone;
    }
    if (input.schedule !== undefined) {
      data.sendWeekdays = [...input.schedule.weekdays].sort((a, b) => a - b);
      data.sendWindowStartMinute = input.schedule.windowStartMinute;
      data.sendWindowEndMinute = input.schedule.windowEndMinute;
    }
    if (input.sender !== undefined) {
      data.emailAccountId = input.sender.emailAccountId;
    }
    if (input.approvalMode !== undefined) {
      data.approvalMode = input.approvalMode;
    }
    if (input.scoring !== undefined) {
      // Validated by the request schema (weights add up to 100); null: the defaults again.
      data.scoring = json(input.scoring);
    }
    return data;
  }

  /** Replaces the primary sequence's steps (creating the sequence if there is none). */
  async function replaceSteps(
    db: Prisma.TransactionClient,
    campaignId: string,
    steps: z.output<typeof updateCampaignRequestSchema>['sequence'] & object,
  ): Promise<void> {
    const existing = await db.sequence.findFirst({
      where: { tenantId, campaignId },
      ...PRIMARY_SEQUENCE,
      select: { id: true },
    });
    const sequenceId =
      existing?.id ??
      (
        await db.sequence.create({
          data: { tenantId, campaignId, name: 'Main' },
          select: { id: true },
        })
      ).id;
    try {
      await db.sequenceStep.deleteMany({ where: { tenantId, sequenceId } });
    } catch (error) {
      // A step that drafts were written for cannot be removed: the campaign is in use.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new CampaignNotEditableError();
      }
      throw error;
    }
    if (steps.steps.length > 0) {
      await db.sequenceStep.createMany({
        data: steps.steps.map((step, index) => ({
          tenantId,
          sequenceId,
          position: index + 1,
          delayMinutes: step.delayMinutes,
          templateId: step.templateId ?? null,
        })),
      });
    }
  }

  /** "<name> (copy)", then "(copy 2)", … : the first name no campaign of the workspace has. */
  async function copyName(db: DbClient, name: string): Promise<string> {
    const base = name.slice(0, 100).trimEnd();
    const taken = new Set(
      (
        await db.campaign.findMany({
          where: { tenantId, name: { startsWith: base } },
          select: { name: true },
        })
      ).map((campaign) => campaign.name),
    );
    for (let n = 1; n <= 1000; n += 1) {
      const candidate =
        n === 1 ? `${base} (copy)` : `${base} (copy ${String(n)})`;
      if (!taken.has(candidate)) {
        return candidate;
      }
    }
    throw new CampaignNameTakenError();
  }

  return {
    async list(page) {
      requireReadPermission(actor, 'campaigns.read');
      const result = await paginate(page, (keyset) =>
        prisma.campaign.findMany({
          where: { tenantId, ...keyset.cursorWhere },
          orderBy: keyset.orderBy,
          take: keyset.take,
          include: CAMPAIGN_INCLUDE,
        }),
      );
      return {
        nextCursor: result.nextCursor,
        items: result.items.map((row) => {
          const config = toConfig(row);
          return {
            id: config.id,
            name: config.name,
            status: config.status,
            version: config.version,
            approvalMode: config.approvalMode,
            readiness: config.readiness,
            updatedAt: config.updatedAt,
          };
        }),
      };
    },

    async options() {
      requireReadPermission(actor, 'campaigns.read');
      const byName = {
        orderBy: { name: 'asc' as const },
        take: CAMPAIGN_OPTIONS_LIMIT,
      };
      const [icps, leadLists, mailboxes, templates] = await prisma.$transaction(
        [
          prisma.icp.findMany({
            where: { tenantId, status: { not: 'ARCHIVED' } },
            select: { id: true, name: true },
            ...byName,
          }),
          prisma.leadList.findMany({
            where: { tenantId, status: 'ACTIVE' },
            select: { id: true, name: true },
            ...byName,
          }),
          prisma.emailAccount.findMany({
            where: { tenantId, status: { not: 'DISCONNECTED' } },
            select: { id: true, email: true, provider: true, status: true },
            orderBy: { email: 'asc' },
            take: CAMPAIGN_OPTIONS_LIMIT,
          }),
          prisma.template.findMany({
            where: { tenantId, status: 'ACTIVE' },
            select: { id: true, name: true },
            ...byName,
          }),
        ],
      );
      return {
        icps,
        leadLists,
        // DISCONNECTED is filtered out above; the type doesn't know it.
        mailboxes: mailboxes.flatMap((mailbox) =>
          mailbox.status === 'DISCONNECTED'
            ? []
            : [{ ...mailbox, status: mailbox.status }],
        ),
        templates,
      };
    },

    async get(rawId) {
      requireReadPermission(actor, 'campaigns.read');
      return load(prisma, campaignIdOf(rawId));
    },

    async create(rawInput) {
      const member = requirePermission(actor, 'campaigns.write');
      const input = createCampaignRequestSchema.parse(rawInput);
      try {
        return await prisma.$transaction(async (tx) => {
          const settings = await tx.tenantSettings.findUnique({
            where: { tenantId },
            select: { timezone: true },
          });
          // Status DRAFT, version 1 and HUMAN approval are the column defaults.
          const campaign = await tx.campaign.create({
            data: {
              tenantId,
              name: input.name,
              description: input.description ?? null,
              timezone: settings?.timezone ?? 'UTC',
            },
            select: { id: true },
          });
          await tx.sequence.create({
            data: { tenantId, campaignId: campaign.id, name: 'Main' },
          });
          await writeAuditRecord(tx, tenantId, member, {
            action: 'campaign.created',
            targetType: 'campaign',
            targetId: campaign.id,
          });
          return load(tx, campaign.id);
        });
      } catch (error) {
        throw isUniqueViolation(error) ? new CampaignNameTakenError() : error;
      }
    },

    async update(rawId, rawInput) {
      const member = requirePermission(actor, 'campaigns.write');
      const campaignId = campaignIdOf(rawId);
      const input = updateCampaignRequestSchema.parse(rawInput);
      if (input.approvalMode === 'AUTOMATIC') {
        // Waiving approval is a decision for someone who may approve.
        requirePermission(actor, 'drafts.approve');
      }
      // In the contract's order, whatever the order of the request.
      const sections = CAMPAIGN_SECTIONS.filter(
        (section) => input[section] !== undefined,
      );
      try {
        return await prisma.$transaction(async (tx) => {
          const current = await tx.campaign.findUnique({
            where: { tenantId_id: { tenantId, id: campaignId } },
            select: { status: true, version: true },
          });
          if (current === null) {
            throw new RecordNotFoundError('campaign');
          }
          if (current.status !== 'DRAFT') {
            throw new CampaignNotEditableError();
          }
          if (current.version !== input.version) {
            throw new CampaignVersionConflictError();
          }
          await checkReferences(tx, input);
          // Compare-and-set: a concurrent save of the same version waits for this row and then
          // matches nothing.
          const saved = await tx.campaign.updateMany({
            where: {
              tenantId,
              id: campaignId,
              version: input.version,
              status: 'DRAFT',
            },
            data: { ...changes(input), version: { increment: 1 } },
          });
          if (saved.count === 0) {
            throw new CampaignVersionConflictError();
          }
          if (input.sequence !== undefined) {
            await replaceSteps(tx, campaignId, input.sequence);
          }
          await writeAuditRecord(tx, tenantId, member, {
            action: 'campaign.updated',
            targetType: 'campaign',
            targetId: campaignId,
            metadata: { sections, version: input.version + 1 },
          });
          return load(tx, campaignId);
        });
      } catch (error) {
        throw isUniqueViolation(error) ? new CampaignNameTakenError() : error;
      }
    },

    async readiness(rawId, services = BUILT_SERVICES) {
      requireReadPermission(actor, 'campaigns.read');
      const campaignId = campaignIdOf(rawId);
      return prisma.$transaction(
        async (tx) => {
          const campaign = await load(tx, campaignId);
          return evaluateActivation(
            campaign,
            await gatherFacts(tx, campaign),
            services,
          );
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },

    async activate(rawId, rawInput, services = BUILT_SERVICES) {
      const member = requirePermission(actor, 'campaigns.write');
      const campaignId = campaignIdOf(rawId);
      const { version } = activateCampaignRequestSchema.parse(rawInput);
      return prisma.$transaction(async (tx) => {
        const campaign = await load(tx, campaignId);
        // The version first: a stale (or future) one conflicts, even for a running campaign.
        if (campaign.version !== version) {
          throw new CampaignVersionConflictError();
        }
        // Already started from this version: the same answer again, nothing changes.
        if (campaign.status === 'ACTIVE') {
          return campaign;
        }
        if (campaign.status !== 'DRAFT') {
          throw new CampaignNotEditableError();
        }
        if (campaign.approvalMode === 'AUTOMATIC') {
          // Starting without human approval is a decision for someone who may approve.
          requirePermission(actor, 'drafts.approve');
        }
        const report = evaluateActivation(
          campaign,
          await gatherFacts(tx, campaign),
          services,
        );
        if (!report.ready) {
          throw new CampaignNotReadyError(report);
        }
        // Compare-and-set; the version stays, so a repeat is recognised above.
        const started = await tx.campaign.updateMany({
          where: { tenantId, id: campaignId, version, status: 'DRAFT' },
          data: { status: 'ACTIVE', activatedAt: now() },
        });
        if (started.count === 0) {
          // Another request got there first: started from this version is the same result.
          const current = await load(tx, campaignId);
          if (current.status === 'ACTIVE' && current.version === version) {
            return current;
          }
          throw new CampaignVersionConflictError();
        }
        await writeAuditRecord(tx, tenantId, member, {
          action: 'campaign.activated',
          targetType: 'campaign',
          targetId: campaignId,
          metadata: { version },
        });
        return load(tx, campaignId);
      });
    },

    async duplicate(rawId, rawInput) {
      const member = requirePermission(actor, 'campaigns.write');
      const sourceId = campaignIdOf(rawId);
      const input = duplicateCampaignRequestSchema.parse(rawInput);
      try {
        return await prisma.$transaction(async (tx) => {
          const source = await tx.campaign.findUnique({
            where: { tenantId_id: { tenantId, id: sourceId } },
            include: {
              sequences: {
                orderBy: PRIMARY_SEQUENCE.orderBy,
                include: { steps: { orderBy: { position: 'asc' } } },
              },
            },
          });
          if (source === null) {
            throw new RecordNotFoundError('campaign');
          }
          // Configuration only. Status, version, approval mode and the activation times start
          // over (DRAFT, 1, HUMAN); leads, drafts, approvals, sends and schedules stay behind.
          const copy = await tx.campaign.create({
            data: {
              tenantId,
              name: input.name ?? (await copyName(tx, source.name)),
              description: source.description,
              icpId: source.icpId,
              leadListId: source.leadListId,
              emailAccountId: source.emailAccountId,
              timezone: source.timezone,
              sendWeekdays: source.sendWeekdays,
              sendWindowStartMinute: source.sendWindowStartMinute,
              sendWindowEndMinute: source.sendWindowEndMinute,
              businessProfile: json(source.businessProfile),
              offer: json(source.offer),
              audienceFilters: json(source.audienceFilters),
              exclusions: json(source.exclusions),
              scoring: json(source.scoring),
              dailyNewLeadLimit: source.dailyNewLeadLimit,
              maxLeads: source.maxLeads,
            },
            select: { id: true },
          });
          const sequences =
            source.sequences.length > 0
              ? source.sequences
              : [{ name: 'Main', steps: [] }];
          for (const sequence of sequences) {
            const created = await tx.sequence.create({
              data: { tenantId, campaignId: copy.id, name: sequence.name },
              select: { id: true },
            });
            if (sequence.steps.length > 0) {
              await tx.sequenceStep.createMany({
                data: sequence.steps.map((step) => ({
                  tenantId,
                  sequenceId: created.id,
                  position: step.position,
                  delayMinutes: step.delayMinutes,
                  templateId: step.templateId,
                })),
              });
            }
          }
          await writeAuditRecord(tx, tenantId, member, {
            action: 'campaign.duplicated',
            targetType: 'campaign',
            targetId: copy.id,
            metadata: { sourceCampaignId: source.id },
          });
          return load(tx, copy.id);
        });
      } catch (error) {
        throw isUniqueViolation(error) ? new CampaignNameTakenError() : error;
      }
    },
  };
}
