// Website research of a company (task 09C, docs/decisions.md D-09C-*). Reading needs
// contacts.read (the Leads section); requesting a run and correcting a field need research.run.
// The repository checks both again. The API fetches no page and calls no model: a request
// queues a job task that the worker runs. Corrections compare-and-set on the current version.
import {
  researchCorrectionRequestSchema,
  researchRequestSchema,
  type ResearchAccepted,
} from '@lead-fennec-ai/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
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
export class ResearchController {
  @Get(':workspaceId/organizations/:organizationId/research')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('contacts.read')
  organization(@Req() request: WorkspaceRequest) {
    return requireWorkspace(request).research.organizationResearch(
      param(request, 'organizationId'),
    );
  }

  /** Queued (202): a new run, the one already running, or fresh research (state says which). */
  @Post(':workspaceId/organizations/:organizationId/research')
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
  request(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(researchRequestSchema))
    body: z.output<typeof researchRequestSchema>,
  ): Promise<ResearchAccepted> {
    return requireWorkspace(request).research.request(
      param(request, 'organizationId'),
      body,
    );
  }

  /** A new version with the correction; 409 version_conflict when it isn't on the current one. */
  @Post(':workspaceId/organizations/:organizationId/research/corrections')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('research.run')
  correct(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(researchCorrectionRequestSchema))
    body: z.output<typeof researchCorrectionRequestSchema>,
  ) {
    return requireWorkspace(request).research.correct(
      param(request, 'organizationId'),
      body,
    );
  }

  @Get(':workspaceId/organizations/:organizationId/research/:researchId')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('contacts.read')
  version(@Req() request: WorkspaceRequest) {
    return requireWorkspace(request).research.version(
      param(request, 'organizationId'),
      param(request, 'researchId'),
    );
  }
}
