// The invitee's side (task 04B): preview and accept an invitation with the token from the link.
// Only the signed-in user whose address was invited may use it, and only for the workspace the
// invitation belongs to.
import {
  acceptInvitation,
  listUserWorkspaces,
  previewInvitation,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import {
  acceptInvitationRequestSchema,
  invitationTokenRequestSchema,
} from '@lead-fennec-ai/shared';
import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { z } from 'zod';
import { sha256Hex } from '../auth/auth-crypto.js';
import {
  CsrfGuard,
  OriginGuard,
  SessionGuard,
  requireSession,
} from '../auth/auth-guards.js';
import { AUTH_CLOCK, type AuthClock } from '../auth/auth.policy.js';
import { PRISMA_CLIENT } from '../database/database.module.js';
import { ApiExceptionFilter, notFound, ZodPipe } from '../http/api-errors.js';
import type { WorkspaceRequest } from './workspace-guards.js';

@Controller('invitations')
@UseFilters(ApiExceptionFilter)
@UseGuards(ThrottlerGuard, OriginGuard, SessionGuard, CsrfGuard)
export class InvitationsController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {}

  @Post('preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  preview(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(invitationTokenRequestSchema))
    body: z.output<typeof invitationTokenRequestSchema>,
  ) {
    return previewInvitation(
      this.prisma,
      {
        tokenHash: sha256Hex(body.token),
        userId: requireSession(request).user.id,
      },
      this.clock(),
    );
  }

  /** Joins the workspace; returns it with the new membership (for the workspace switcher). */
  @Post('accept')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async accept(
    @Req() request: WorkspaceRequest,
    @Body(new ZodPipe(acceptInvitationRequestSchema))
    body: z.output<typeof acceptInvitationRequestSchema>,
  ) {
    const userId = requireSession(request).user.id;
    const { workspaceId } = await acceptInvitation(
      this.prisma,
      {
        tokenHash: sha256Hex(body.token),
        workspaceId: body.workspaceId,
        userId,
      },
      this.clock(),
    );
    const joined = (await listUserWorkspaces(this.prisma, userId)).find(
      (entry) => entry.workspace.id === workspaceId,
    );
    if (joined === undefined) {
      throw notFound();
    }
    return joined;
  }
}
