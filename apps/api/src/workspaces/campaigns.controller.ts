// Campaign configuration (task 06A, docs/api/campaigns.md). Reads need campaigns.read, changes
// campaigns.write; the repository checks them again, checks the version of every save and
// that every referenced record belongs to the workspace. Registered after the dashboard routes,
// so GET …/campaigns/summary is never read as a campaign id.
import {
  activateCampaignRequestSchema,
  createCampaignRequestSchema,
  duplicateCampaignRequestSchema,
  pageQuerySchema,
  type CampaignServices,
  updateCampaignRequestSchema,
} from '@lead-fennec-ai/shared';
import {
  Body,
  Controller,
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
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth-guards.js';
import { ApiExceptionFilter, ZodPipe } from '../http/api-errors.js';
import { CAMPAIGN_SERVICES } from './campaign-services.js';
import {
  PermissionGuard,
  RequirePermissions,
  WorkspaceGuard,
  requireWorkspace,
  type WorkspaceRequest,
} from './workspace-guards.js';

const campaignIdOf = (request: WorkspaceRequest) =>
  request.params?.['campaignId'] ?? '';

@Controller('workspaces')
@UseFilters(ApiExceptionFilter)
@UseGuards(ThrottlerGuard)
export class CampaignsController {
  constructor(
    @Inject(CAMPAIGN_SERVICES) private readonly services: CampaignServices,
  ) {}

  @Get(':workspaceId/campaigns')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('campaigns.read')
  list(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(pageQuerySchema))
    query: z.output<typeof pageQuerySchema>,
  ) {
    return requireWorkspace(request).campaigns.list(query);
  }

  /** A new DRAFT: inactive, human approval, the workspace's time zone. */
  @Post(':workspaceId/campaigns')
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
  create(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(createCampaignRequestSchema))
    body: z.output<typeof createCampaignRequestSchema>,
  ) {
    return requireWorkspace(request).campaigns.create(body);
  }

  /** Declared before :campaignId, so "options" is never read as a campaign id. */
  @Get(':workspaceId/campaigns/options')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('campaigns.read')
  options(@Req() request: WorkspaceRequest) {
    return requireWorkspace(request).campaigns.options();
  }

  @Get(':workspaceId/campaigns/:campaignId')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('campaigns.read')
  get(@Req() request: WorkspaceRequest) {
    return requireWorkspace(request).campaigns.get(campaignIdOf(request));
  }

  /** Every check that must pass before the campaign can start (task 06C). */
  @Get(':workspaceId/campaigns/:campaignId/readiness')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('campaigns.read')
  readiness(@Req() request: WorkspaceRequest) {
    return requireWorkspace(request).campaigns.readiness(
      campaignIdOf(request),
      this.services,
    );
  }

  /**
   * The only way a campaign starts: a current version and every check passing; 409
   * campaign_not_ready with each reason otherwise. Repeating it changes nothing.
   */
  @Post(':workspaceId/campaigns/:campaignId/activate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('campaigns.write')
  activate(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(activateCampaignRequestSchema))
    body: z.output<typeof activateCampaignRequestSchema>,
  ) {
    return requireWorkspace(request).campaigns.activate(
      campaignIdOf(request),
      body,
      this.services,
    );
  }

  /** Saves the sections sent if `version` is current; 409 version_conflict otherwise. */
  @Patch(':workspaceId/campaigns/:campaignId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('campaigns.write')
  update(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(updateCampaignRequestSchema))
    body: z.output<typeof updateCampaignRequestSchema>,
  ) {
    return requireWorkspace(request).campaigns.update(
      campaignIdOf(request),
      body,
    );
  }

  /** A new DRAFT with the configuration only: no leads, drafts, approvals or sends. */
  @Post(':workspaceId/campaigns/:campaignId/duplicate')
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
  duplicate(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(duplicateCampaignRequestSchema))
    body: z.output<typeof duplicateCampaignRequestSchema>,
  ) {
    return requireWorkspace(request).campaigns.duplicate(
      campaignIdOf(request),
      body,
    );
  }
}
