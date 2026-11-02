// Dashboard aggregates (task 05C, docs/decisions.md D-05C-01). Read-only routes under the
// section that owns each kind of data, each with that section's permission: the dashboard shows
// a member only what their role lets them open anyway. The repositories check the permission
// again and filter every query by the workspace.
import {
  ACTIVITY_DEFAULT_LIMIT,
  activityQuerySchema,
} from '@lead-fennec-ai/shared';
import {
  Controller,
  Get,
  Header,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { z } from 'zod';
import { SessionGuard } from '../auth/auth-guards.js';
import { ApiExceptionFilter, ZodPipe } from '../http/api-errors.js';
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
export class DashboardController {
  @Get(':workspaceId/leads/summary')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('contacts.read')
  leadSummary(@Req() request: WorkspaceRequest) {
    return requireWorkspace(request).dashboard.leadSummary();
  }

  @Get(':workspaceId/campaigns/summary')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('campaigns.read')
  campaignSummary(@Req() request: WorkspaceRequest) {
    return requireWorkspace(request).dashboard.campaignSummary();
  }

  /** The latest audit records (at most 25) with counts for the last 24 hours, 7 and 30 days. */
  @Get(':workspaceId/activity')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('audit.read')
  activity(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(activityQuerySchema))
    query: z.output<typeof activityQuerySchema>,
  ) {
    return requireWorkspace(request).dashboard.activity(
      query.limit ?? ACTIVITY_DEFAULT_LIMIT,
    );
  }

  @Get(':workspaceId/integrations/health')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('settings.manage')
  integrationHealth(@Req() request: WorkspaceRequest) {
    return requireWorkspace(request).dashboard.integrationHealth();
  }
}
