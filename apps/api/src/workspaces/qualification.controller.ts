// Lead qualification (task 10C, docs/decisions.md D-10C-*). Reading a campaign's leads and one
// lead needs campaigns.read (the Campaigns section); the repository also needs contacts.read and
// scores.read. Asking for a qualification run needs research.run: the API calls no model, it
// queues a job for the worker. A person's decision needs campaigns.write (and drafts.approve to
// accept eligibility review reasons); it names the version it started from (409
// version_conflict) and never qualifies a blocked lead (409 qualification_blocked).
import {
  pageQuerySchema,
  qualificationDecisionRequestSchema,
  qualifyRequestSchema,
  type LeadPage,
  type LeadQualificationView,
  type QualifyAccepted,
} from '@lead-fennec-ai/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
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

const param = (request: WorkspaceRequest, name: string) =>
  request.params?.[name] ?? '';

@Controller('workspaces')
@UseFilters(ApiExceptionFilter)
@UseGuards(ThrottlerGuard)
export class QualificationController {
  @Get(':workspaceId/campaigns/:campaignId/leads')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('campaigns.read')
  leads(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(pageQuerySchema))
    query: z.output<typeof pageQuerySchema>,
  ): Promise<LeadPage> {
    return requireWorkspace(request).qualification.list(
      param(request, 'campaignId'),
      query,
    );
  }

  @Get(':workspaceId/campaigns/:campaignId/leads/:contactId')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('campaigns.read')
  lead(@Req() request: WorkspaceRequest): Promise<LeadQualificationView> {
    return requireWorkspace(request).qualification.view(
      param(request, 'campaignId'),
      param(request, 'contactId'),
    );
  }

  /** Queued (202): a new run, or the one already queued (state says which). */
  @Post(':workspaceId/campaigns/:campaignId/leads/:contactId/qualify')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('research.run')
  qualify(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(qualifyRequestSchema))
    body: z.output<typeof qualifyRequestSchema>,
  ): Promise<QualifyAccepted> {
    return requireWorkspace(request).qualification.request(
      param(request, 'campaignId'),
      param(request, 'contactId'),
      body,
    );
  }

  /** A person's decision (201): the lead as it now stands. */
  @Post(':workspaceId/campaigns/:campaignId/leads/:contactId/decisions')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('campaigns.write')
  decide(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(qualificationDecisionRequestSchema))
    body: z.output<typeof qualificationDecisionRequestSchema>,
  ): Promise<LeadQualificationView> {
    return requireWorkspace(request).qualification.decide(
      param(request, 'campaignId'),
      param(request, 'contactId'),
      body,
    );
  }
}
