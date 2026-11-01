// Platform-admin operations (task 04B, docs/decisions.md D-04B-06). Explicit routes only, each
// with a stated reason and audit records; being a platform admin grants nothing on the member
// routes. The admin is the session's user, re-checked on every request.
import {
  platformAdminScope,
  platformConsole,
  TenantAccessDeniedError,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import {
  ACCESS_REASON_HEADER,
  accessReasonSchema,
  pageQuerySchema,
  platformAccessRequestSchema,
  setWorkspaceStatusRequestSchema,
} from '@lead-fennec-ai/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { z } from 'zod';
import {
  CsrfGuard,
  OriginGuard,
  SessionGuard,
  requireSession,
} from '../auth/auth-guards.js';
import { AUTH_CLOCK, type AuthClock } from '../auth/auth.policy.js';
import { PRISMA_CLIENT } from '../database/database.module.js';
import { ApiExceptionFilter, forbidden, ZodPipe } from '../http/api-errors.js';
import { requestIdOf, type WorkspaceRequest } from './workspace-guards.js';

/** Refusals (not an admin, or no such workspace) are recorded by the database layer, then 403. */
async function asAdmin<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TenantAccessDeniedError) {
      throw forbidden();
    }
    throw error;
  }
}

@Controller('platform')
@UseFilters(ApiExceptionFilter)
@UseGuards(ThrottlerGuard, OriginGuard, SessionGuard, CsrfGuard)
export class PlatformController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {}

  /** Every workspace, newest first. The reason goes in the x-access-reason header. */
  @Get('workspaces')
  @Header('Cache-Control', 'no-store')
  async workspaces(
    @Req() request: WorkspaceRequest,
    @Headers(ACCESS_REASON_HEADER) reasonHeader: string | undefined,
    @Query(new ZodPipe(pageQuerySchema))
    query: z.output<typeof pageQuerySchema>,
  ) {
    const reason = new ZodPipe(accessReasonSchema).transform(reasonHeader);
    const console = await asAdmin(() =>
      platformConsole(this.prisma, {
        userId: requireSession(request).user.id,
        reason,
        requestId: requestIdOf(request),
      }),
    );
    const page = await console.listTenants(query);
    return {
      items: page.items.map(({ id, slug, name, status, createdAt }) => ({
        id,
        slug,
        name,
        status,
        createdAt,
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** Opens audited, read-only access to one workspace and returns its summary. */
  @Post('workspaces/:workspaceId/access')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async access(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(platformAccessRequestSchema))
    body: z.output<typeof platformAccessRequestSchema>,
  ) {
    const scope = await asAdmin(() =>
      platformAdminScope(
        this.prisma,
        {
          tenantId: request.params?.['workspaceId'] ?? '',
          userId: requireSession(request).user.id,
          reason: body.reason,
          requestId: requestIdOf(request),
        },
        { now: this.clock },
      ),
    );
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: scope.tenantId },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        createdAt: true,
      },
    });
    return {
      workspace: tenant,
      memberCount: await scope.db.membership.count({
        where: { status: 'ACTIVE' },
      }),
    };
  }

  /** Suspends or reactivates a workspace; one platform audit record per change. */
  @Post('workspaces/:workspaceId/status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async setStatus(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(setWorkspaceStatusRequestSchema))
    body: z.output<typeof setWorkspaceStatusRequestSchema>,
  ) {
    const console = await asAdmin(() =>
      platformConsole(this.prisma, {
        userId: requireSession(request).user.id,
        reason: body.reason,
        requestId: requestIdOf(request),
      }),
    );
    const { id, slug, name, status, createdAt } = await console.setTenantStatus(
      {
        tenantId: request.params?.['workspaceId'] ?? '',
        status: body.status,
        reason: body.reason,
      },
    );
    return { id, slug, name, status, createdAt };
  }
}
