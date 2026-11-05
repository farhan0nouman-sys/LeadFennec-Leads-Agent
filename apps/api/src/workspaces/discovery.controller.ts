// Lead discovery (task 07A, docs/api/discovery.md). A request queues an organization search
// from one of the workspace's ICPs and answers 202 with the run id and its status URL; the
// search itself runs in a worker (task 07C). Both routes need imports.create, which the
// repository checks again. Only the provider's declared capabilities are used here: nothing
// is requested from it while the API answers.
import {
  DISCOVERY_ROUTES,
  discoveryRequestSchema,
  type DiscoveryAccepted,
} from '@lead-fennec-ai/shared';
import type { OrganizationSearchProvider } from '@lead-fennec-ai/integrations';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { z } from 'zod';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth-guards.js';
import { ApiExceptionFilter, ZodPipe } from '../http/api-errors.js';
import { ORGANIZATION_SEARCH } from './discovery-provider.js';
import {
  PermissionGuard,
  RequirePermissions,
  WorkspaceGuard,
  requireWorkspace,
  type WorkspaceRequest,
} from './workspace-guards.js';

@Controller('workspaces')
@UseFilters(ApiExceptionFilter)
@UseGuards(ThrottlerGuard)
export class DiscoveryController {
  constructor(
    @Inject(ORGANIZATION_SEARCH)
    private readonly provider: OrganizationSearchProvider,
  ) {}

  /** A PENDING run with a queued task; 400 with one issue per reason it can't run. */
  @Post(':workspaceId/imports/discovery')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('imports.create')
  async request(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(discoveryRequestSchema))
    body: z.output<typeof discoveryRequestSchema>,
  ): Promise<DiscoveryAccepted> {
    const scope = requireWorkspace(request);
    const run = await scope.discovery.request(body, {
      source: this.provider.source,
      capabilities: this.provider.capabilities,
    });
    return {
      runId: run.id,
      status: run.status,
      statusUrl: DISCOVERY_ROUTES.run(scope.tenantId, run.id),
    };
  }

  @Get(':workspaceId/imports/:importId')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('imports.create')
  get(@Req() request: WorkspaceRequest) {
    return requireWorkspace(request).discovery.get(
      request.params?.['importId'] ?? '',
    );
  }
}
