// Lead search (task 11A, docs/api/leads.md). The workspace's people, searched with allowlisted
// filters and sorts one page at a time; one person in detail; the evidence about them. Every
// route needs contacts.read, which the repository checks again (with scores.read and
// campaigns.read for those parts). Queries are validated by the repository's own schema
// (leadSearchQuerySchema): an unknown sort, filter or value is a 400, a cursor of another
// search a 400. Registered after DashboardController: GET …/leads/summary matches there first.
import {
  leadAssignmentRequestSchema,
  leadCorrectionRequestSchema,
  leadEvidenceQuerySchema,
  leadNoteRequestSchema,
  leadSearchQuerySchema,
  leadTagsRequestSchema,
  type LeadDetail,
  type LeadSearchPage,
} from '@lead-fennec-ai/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
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
export class LeadsController {
  @Get(':workspaceId/leads')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('contacts.read')
  search(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(leadSearchQuerySchema))
    query: z.output<typeof leadSearchQuerySchema>,
  ): Promise<LeadSearchPage> {
    return requireWorkspace(request).leads.search(query);
  }

  @Get(':workspaceId/leads/:contactId')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('contacts.read')
  lead(@Req() request: WorkspaceRequest): Promise<LeadDetail> {
    return requireWorkspace(request).leads.detail(param(request, 'contactId'));
  }

  @Get(':workspaceId/leads/:contactId/evidence')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('contacts.read')
  evidence(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(leadEvidenceQuerySchema))
    query: z.output<typeof leadEvidenceQuerySchema>,
  ) {
    return requireWorkspace(request).leads.evidence(
      param(request, 'contactId'),
      query,
    );
  }

  // Changes (task 11B): each names the lead's version (409 when stale). The repository checks the
  // permission again and the ownership of every referenced record.

  /** The corrected lead; a material correction also makes its drafts and decisions stale. */
  @Patch(':workspaceId/leads/:contactId')
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('contacts.write')
  correct(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(leadCorrectionRequestSchema))
    body: z.output<typeof leadCorrectionRequestSchema>,
  ): Promise<LeadDetail> {
    return requireWorkspace(request).leads.correct(
      param(request, 'contactId'),
      body,
    );
  }

  @Patch(':workspaceId/leads/:contactId/tags')
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('contacts.write')
  tags(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(leadTagsRequestSchema))
    body: z.output<typeof leadTagsRequestSchema>,
  ): Promise<LeadDetail> {
    return requireWorkspace(request).leads.setTags(
      param(request, 'contactId'),
      body,
    );
  }

  @Post(':workspaceId/leads/:contactId/notes')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('contacts.write')
  note(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(leadNoteRequestSchema))
    body: z.output<typeof leadNoteRequestSchema>,
  ): Promise<LeadDetail> {
    return requireWorkspace(request).leads.addNote(
      param(request, 'contactId'),
      body,
    );
  }

  /** 409 assignment_not_possible with one issue per reason. */
  @Post(':workspaceId/leads/:contactId/campaigns')
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
  assign(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(leadAssignmentRequestSchema))
    body: z.output<typeof leadAssignmentRequestSchema>,
  ): Promise<LeadDetail> {
    return requireWorkspace(request).leads.assign(
      param(request, 'contactId'),
      body,
    );
  }
}
