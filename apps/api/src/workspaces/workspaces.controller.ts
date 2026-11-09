// Workspaces and their teams (task 04B, docs/api/workspaces.md). Every route derives the user
// from the session; routes under :workspaceId also run WorkspaceGuard (active membership) and
// PermissionGuard (role permissions).
import {
  createWorkspace,
  listUserWorkspaces,
  type AuthStore,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import type { TransactionalMailProvider } from '@lead-fennec-ai/integrations';
import {
  changeMemberRoleRequestSchema,
  createInvitationRequestSchema,
  createWorkspaceRequestSchema,
  INVITATION_LINK_PATH,
  pageQuerySchema,
} from '@lead-fennec-ai/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { z } from 'zod';
import { newToken, sha256Hex } from '../auth/auth-crypto.js';
import {
  CsrfGuard,
  OriginGuard,
  SessionGuard,
  requireSession,
} from '../auth/auth-guards.js';
import {
  AUTH_CLOCK,
  AUTH_POLICY,
  type AuthClock,
  type AuthPolicy,
} from '../auth/auth.policy.js';
import { AUTH_STORE, PRISMA_CLIENT } from '../database/database.module.js';
import { API_ENV, type ApiEnv } from '../env.js';
import {
  ApiExceptionFilter,
  notFound,
  tooManyRequests,
  ZodPipe,
} from '../http/api-errors.js';
import { TRANSACTIONAL_MAIL } from '../mail/mail.module.js';
import {
  PermissionGuard,
  RequirePermissions,
  WorkspaceGuard,
  requireWorkspace,
  type WorkspaceRequest,
} from './workspace-guards.js';
import { invitationMessage, slugFromName } from './workspace-support.js';

type PageQuery = z.output<typeof pageQuerySchema>;

@Controller('workspaces')
@UseFilters(ApiExceptionFilter)
@UseGuards(ThrottlerGuard)
export class WorkspacesController {
  private readonly webAppUrl: string;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    @Inject(TRANSACTIONAL_MAIL)
    private readonly mail: TransactionalMailProvider,
    @Inject(AUTH_POLICY) private readonly policy: AuthPolicy,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.webAppUrl = env.WEB_APP_URL;
  }

  /** Creates a workspace; the signed-in user becomes its first Client Admin. */
  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard, SessionGuard, CsrfGuard)
  create(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(createWorkspaceRequestSchema))
    body: z.output<typeof createWorkspaceRequestSchema>,
  ) {
    return createWorkspace(
      this.prisma,
      {
        userId: requireSession(request).user.id,
        name: body.name,
        slug: body.slug ?? slugFromName(body.name),
      },
      this.clock(),
    );
  }

  /** The signed-in user's active workspaces (for the workspace switcher). */
  @Get()
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard)
  async list(@Req() request: WorkspaceRequest) {
    return {
      items: await listUserWorkspaces(
        this.prisma,
        requireSession(request).user.id,
      ),
    };
  }

  @Get(':workspaceId')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard)
  async get(@Req() request: WorkspaceRequest) {
    const scope = requireWorkspace(request);
    const mine = await listUserWorkspaces(
      this.prisma,
      requireSession(request).user.id,
    );
    const found = mine.find((entry) => entry.workspace.id === scope.tenantId);
    if (found === undefined) {
      throw notFound();
    }
    return found;
  }

  @Get(':workspaceId/members')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('members.read')
  members(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(pageQuerySchema)) query: PageQuery,
  ) {
    return requireWorkspace(request).members.list(query);
  }

  /** Gives a member another role of the same workspace; the last active admin is kept. */
  @Patch(':workspaceId/members/:membershipId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('members.manage')
  changeRole(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(changeMemberRoleRequestSchema))
    body: z.output<typeof changeMemberRoleRequestSchema>,
  ) {
    return requireWorkspace(request).members.changeRole(
      request.params?.['membershipId'] ?? '',
      body.roleId,
    );
  }

  @Get(':workspaceId/roles')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('members.read')
  async roles(@Req() request: WorkspaceRequest) {
    return { items: await requireWorkspace(request).members.roles() };
  }

  @Get(':workspaceId/invitations')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('members.read')
  invitations(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(pageQuerySchema)) query: PageQuery,
  ) {
    return requireWorkspace(request).invitations.listOpen(query);
  }

  /**
   * Invites an address with a role of this workspace and emails the link. The response never
   * contains the token. At most 100 invitation emails per workspace and day.
   */
  @Post(':workspaceId/invitations')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('members.manage')
  async invite(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(createInvitationRequestSchema))
    body: z.output<typeof createInvitationRequestSchema>,
  ) {
    const scope = requireWorkspace(request);
    const now = this.clock();
    const budget = await this.store.recordAttempt(
      'INVITATION_EMAIL',
      sha256Hex(`tenant:${scope.tenantId}`),
      this.policy.invitationEmails,
      now,
    );
    if (!budget.allowed) {
      throw tooManyRequests(
        budget.retryAfterSeconds ?? this.policy.invitationEmails.lockSeconds,
      );
    }
    const token = newToken();
    const invitation = await scope.invitations.create({
      email: body.email,
      roleId: body.roleId,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(
        now.getTime() + this.policy.invitationTokenSeconds * 1000,
      ),
    });
    const workspace = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: scope.tenantId },
      select: { name: true },
    });
    await this.mail.send(
      invitationMessage({
        to: invitation.email,
        link: `${this.webAppUrl}${INVITATION_LINK_PATH}#token=${token}`,
        workspaceName: workspace.name,
        inviterName: invitation.invitedBy.displayName,
        roleName: invitation.role.name,
        validDays: this.policy.invitationTokenSeconds / 86_400,
      }),
    );
    return invitation;
  }

  @Delete(':workspaceId/invitations/:invitationId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('members.manage')
  async revoke(@Req() request: WorkspaceRequest): Promise<void> {
    await requireWorkspace(request).invitations.revoke(
      request.params?.['invitationId'] ?? '',
    );
  }
}
