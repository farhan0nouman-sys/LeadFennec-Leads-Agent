// The do-not-contact list and deletion requests (task 11C, docs/api/suppressions.md). Every route
// needs suppressions.manage, which the repository checks again; a deletion request also needs
// contacts.write (checked there). Addresses never reach the audit records or the logs. Static
// paths (`deletion-requests`) are declared before `:suppressionId`.
import {
  addSuppressionRequestSchema,
  deletionRequestSchema,
  suppressionListQuerySchema,
} from '@lead-fennec-ai/shared';
import {
  Body,
  Controller,
  Delete,
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

const suppressionIdOf = (request: WorkspaceRequest) =>
  request.params?.['suppressionId'] ?? '';

@Controller('workspaces')
@UseFilters(ApiExceptionFilter)
@UseGuards(ThrottlerGuard)
export class SuppressionsController {
  @Get(':workspaceId/suppressions')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('suppressions.manage')
  list(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(suppressionListQuerySchema))
    query: z.output<typeof suppressionListQuerySchema>,
  ) {
    return requireWorkspace(request).suppressions.list(query);
  }

  /** The entry, whether it was new, and how many leads it reopened. */
  @Post(':workspaceId/suppressions')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('suppressions.manage')
  add(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(addSuppressionRequestSchema))
    body: z.output<typeof addSuppressionRequestSchema>,
  ) {
    return requireWorkspace(request).suppressions.add(body);
  }

  /** Erases a person by their address; the address stays on the list. */
  @Post(':workspaceId/suppressions/deletion-requests')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('suppressions.manage')
  deletionRequest(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(deletionRequestSchema))
    body: z.output<typeof deletionRequestSchema>,
  ) {
    return requireWorkspace(request).suppressions.deletePerson(body);
  }

  /** 409 suppression_not_removable for an entry that didn't come from a member. */
  @Delete(':workspaceId/suppressions/:suppressionId')
  @HttpCode(204)
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('suppressions.manage')
  async remove(@Req() request: WorkspaceRequest): Promise<void> {
    await requireWorkspace(request).suppressions.remove(
      suppressionIdOf(request),
    );
  }
}
