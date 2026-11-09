// The workspace's send policy (task 10B, docs/decisions.md D-10B-*): which recipients' countries
// and which data sources may be emailed. Reading and changing it need settings.manage (the
// Workspace settings section); the service checks it again. A save names the version it started
// from (409 version_conflict otherwise) and is audited. Until a policy is set, nobody is eligible
// without a person deciding.
import {
  updateSendPolicyRequestSchema,
  type SendPolicyState,
} from '@lead-fennec-ai/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  Patch,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { z } from 'zod';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth-guards.js';
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
export class SendPolicyController {
  @Get(':workspaceId/settings/send-policy')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('settings.manage')
  sendPolicy(@Req() request: WorkspaceRequest): Promise<SendPolicyState> {
    return requireWorkspace(request).eligibility.policy();
  }

  @Patch(':workspaceId/settings/send-policy')
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('settings.manage')
  updateSendPolicy(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(updateSendPolicyRequestSchema))
    body: z.output<typeof updateSendPolicyRequestSchema>,
  ): Promise<SendPolicyState> {
    return requireWorkspace(request).eligibility.updatePolicy(body);
  }
}
