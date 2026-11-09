// Lead discovery and imports (tasks 07A and 07C, docs/api/discovery.md). A search request
// queues an organization search from one of the workspace's ICPs and answers 202 with the run
// id and its status URL; the worker runs it. A CSV import is processed in the request (it is
// bounded) and answers 201 with its counts. Every route needs imports.create, which the
// repository checks again. Only the provider's declaration is used here (D-07B-05): the API
// holds no provider credentials and requests nothing from a provider. Static paths
// (`discovery`, `csv`, `options`) are declared before `:importId`.
import type { DiscoveryProviderInfo } from '@lead-fennec-ai/database';
import {
  DISCOVERY_ROUTES,
  cancelImportRequestSchema,
  contactImportRequestSchema,
  csvImportRequestSchema,
  discoveryRequestSchema,
  importResultsQuerySchema,
  pageQuerySchema,
  type DiscoveryAccepted,
} from '@lead-fennec-ai/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
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
import { ORGANIZATION_SEARCH } from './discovery-provider.js';
import {
  PermissionGuard,
  RequirePermissions,
  WorkspaceGuard,
  requireWorkspace,
  type WorkspaceRequest,
} from './workspace-guards.js';

const importIdOf = (request: WorkspaceRequest) =>
  request.params?.['importId'] ?? '';

@Controller('workspaces')
@UseFilters(ApiExceptionFilter)
@UseGuards(ThrottlerGuard)
export class DiscoveryController {
  constructor(
    @Inject(ORGANIZATION_SEARCH)
    private readonly provider: DiscoveryProviderInfo,
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
    const run = await scope.discovery.request(body, this.provider);
    return {
      runId: run.id,
      status: run.status,
      statusUrl: DISCOVERY_ROUTES.run(scope.tenantId, run.id),
    };
  }

  /** Every row saved, matched, excluded or reported as failed; 400 for a file it can't read. */
  @Post(':workspaceId/imports/csv')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('imports.create')
  importCsv(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(csvImportRequestSchema))
    body: z.output<typeof csvImportRequestSchema>,
  ) {
    return requireWorkspace(request).discovery.importCsv(body);
  }

  /**
   * A people file (task 11C): every row is checked now (failed rows reported), and the worker
   * saves the rest in batches. Also needs contacts.write (and lead_lists.write with a list),
   * which the repository checks.
   */
  @Post(':workspaceId/imports/contacts')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('imports.create')
  importContacts(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(contactImportRequestSchema))
    body: z.output<typeof contactImportRequestSchema>,
  ) {
    return requireWorkspace(request).contactImports.request(body);
  }

  @Get(':workspaceId/imports')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('imports.create')
  list(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(pageQuerySchema))
    query: z.output<typeof pageQuerySchema>,
  ) {
    return requireWorkspace(request).discovery.list(query);
  }

  @Get(':workspaceId/imports/options')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('imports.create')
  options(@Req() request: WorkspaceRequest) {
    return requireWorkspace(request).discovery.options(this.provider);
  }

  @Get(':workspaceId/imports/:importId')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('imports.create')
  get(@Req() request: WorkspaceRequest) {
    return requireWorkspace(request).discovery.get(importIdOf(request));
  }

  @Get(':workspaceId/imports/:importId/results')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('imports.create')
  results(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(importResultsQuerySchema))
    query: z.output<typeof importResultsQuerySchema>,
  ) {
    return requireWorkspace(request).discovery.results(
      importIdOf(request),
      query,
    );
  }

  /** Stops a queued or running search; 409 import_not_cancellable once it finished. */
  @Post(':workspaceId/imports/:importId/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('imports.create')
  cancel(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(cancelImportRequestSchema))
    body: z.output<typeof cancelImportRequestSchema>,
  ) {
    return requireWorkspace(request).discovery.cancel(
      importIdOf(request),
      body,
    );
  }
}
