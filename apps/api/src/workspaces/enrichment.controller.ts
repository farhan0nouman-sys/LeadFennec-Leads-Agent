// Contact enrichment (task 08C, docs/api/enrichment.md). A request queues people search for the
// companies a finished run saved and answers 202 with the run id; the worker runs it, one company
// at a time, and the run's progress is read with GET …/imports/:importId. The results route lists
// what each person became. A recheck queues a new check of one contact's address, within limits.
// Routes need their listed permission, which the repository checks again (a request also needs
// contacts.write there). Only the provider's declaration is used here: the API holds no
// provider credentials and calls no provider.
import type { ContactProviderInfo } from '@lead-fennec-ai/database';
import {
  DISCOVERY_ROUTES,
  enrichmentRequestSchema,
  enrichmentResultsQuerySchema,
  recheckRequestSchema,
  type EnrichmentAccepted,
  type RecheckAccepted,
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
import {
  CONTACT_PROVIDER,
  EMAIL_VERIFICATION,
  type EmailVerificationInfo,
} from './enrichment-provider.js';
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
export class EnrichmentController {
  constructor(
    @Inject(CONTACT_PROVIDER)
    private readonly provider: ContactProviderInfo,
    @Inject(EMAIL_VERIFICATION)
    private readonly verification: EmailVerificationInfo,
  ) {}

  /** A PENDING run with a queued task; 400 with one issue per reason it can't run. */
  @Post(':workspaceId/imports/:importId/enrichment')
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
    @Body(new ZodPipe(enrichmentRequestSchema))
    body: z.output<typeof enrichmentRequestSchema>,
  ): Promise<EnrichmentAccepted> {
    const scope = requireWorkspace(request);
    const run = await scope.enrichment.request(
      param(request, 'importId'),
      body,
      this.provider,
    );
    return {
      runId: run.id,
      status: run.status,
      statusUrl: DISCOVERY_ROUTES.run(scope.tenantId, run.id),
    };
  }

  @Get(':workspaceId/imports/:importId/contacts')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, WorkspaceGuard, PermissionGuard)
  @RequirePermissions('imports.create')
  contacts(
    @Req() request: WorkspaceRequest,
    @Query(new ZodPipe(enrichmentResultsQuerySchema))
    query: z.output<typeof enrichmentResultsQuerySchema>,
  ) {
    return requireWorkspace(request).enrichment.results(
      param(request, 'importId'),
      query,
    );
  }

  /** 202 queued (or already queued); 409 without an address or a verifier; 429 over a limit. */
  @Post(':workspaceId/contacts/:contactId/recheck')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @UseGuards(
    OriginGuard,
    SessionGuard,
    CsrfGuard,
    WorkspaceGuard,
    PermissionGuard,
  )
  @RequirePermissions('verifications.run')
  recheck(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(recheckRequestSchema))
    body: z.output<typeof recheckRequestSchema>,
  ): Promise<RecheckAccepted> {
    return requireWorkspace(request).enrichment.requestRecheck(
      param(request, 'contactId'),
      body,
      this.verification.available,
    );
  }
}
