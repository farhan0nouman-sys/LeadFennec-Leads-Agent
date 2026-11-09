// Lead exports (task 11C, docs/api/exports.md). A member with contacts.export makes a CSV file of
// a lead search; only they can list and download it, until it expires (24 hours). Reads sit in
// the Leads section, so their guard asks for contacts.read; the repository requires
// contacts.export and the requester's own membership on every route. The download is the file
// itself (text/csv, an attachment, never cached), not JSON; an expired file is 410.
import type { ServerResponse } from 'node:http';
import {
  leadExportRequestSchema,
  pageQuerySchema,
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
  Res,
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

const exportIdOf = (request: WorkspaceRequest) =>
  request.params?.['exportId'] ?? '';

@Controller('workspaces')
@UseFilters(ApiExceptionFilter)
@UseGuards(ThrottlerGuard)
export class ExportsController {
  @Get(':workspaceId/exports')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('contacts.read')
  list(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(pageQuerySchema))
    query: z.output<typeof pageQuerySchema>,
  ) {
    return requireWorkspace(request).exports.list(query);
  }

  /** 409 export_limit_reached with the most files waiting. */
  @Post(':workspaceId/exports')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('contacts.export')
  create(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(leadExportRequestSchema))
    body: z.output<typeof leadExportRequestSchema>,
  ) {
    return requireWorkspace(request).exports.createLeadExport(body);
  }

  /** The file; 410 export_expired after it expired, 404 for another member's. */
  @Get(':workspaceId/exports/:exportId/download')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('contacts.read')
  async download(
    @Req() request: WorkspaceRequest,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<string> {
    const file = await requireWorkspace(request).exports.download(
      exportIdOf(request),
    );
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // The name is made by the server ([a-z0-9-].csv), never taken from a request.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return file.content;
  }
}
