// HTTP routes of the auth contract (@lead-fennec-ai/shared contracts/auth.ts, docs/api/auth.md).
import type { ServerResponse } from 'node:http';
import {
  emailRequestSchema,
  loginRequestSchema,
  passwordResetConfirmRequestSchema,
  registerRequestSchema,
  verifyEmailRequestSchema,
  type SessionResponse,
} from '@lead-fennec-ai/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { z } from 'zod';
import { ApiExceptionFilter, ZodPipe } from '../http/api-errors.js';
import { requestIdOf } from '../http/request-id.js';
import {
  CsrfGuard,
  OriginGuard,
  SessionGuard,
  requireSession,
  type ApiRequest,
} from './auth-guards.js';
import { AuthService } from './auth.service.js';
import {
  clearedSessionCookie,
  readSessionToken,
  sessionCookie,
} from './session-cookie.js';

const ACCEPTED = { status: 'accepted' } as const;

@Controller('auth')
@UseFilters(ApiExceptionFilter)
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 202 whether or not the address already has an account; the email tells the owner. */
  @Post('register')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  register(
    @Body(new ZodPipe(registerRequestSchema))
    body: z.output<typeof registerRequestSchema>,
    @Req() request: ApiRequest,
  ): typeof ACCEPTED {
    this.auth.register(body, requestIdOf(request));
    return ACCEPTED;
  }

  @Post('verify-email')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  async verifyEmail(
    @Body(new ZodPipe(verifyEmailRequestSchema))
    body: z.output<typeof verifyEmailRequestSchema>,
    @Req() request: ApiRequest,
  ): Promise<{ status: 'verified' }> {
    await this.auth.verifyEmail(body.token, requestIdOf(request));
    return { status: 'verified' };
  }

  @Post('verify-email/resend')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  resendVerification(
    @Body(new ZodPipe(emailRequestSchema))
    body: z.output<typeof emailRequestSchema>,
  ): typeof ACCEPTED {
    this.auth.resendVerification(body.email);
    return ACCEPTED;
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  async login(
    @Body(new ZodPipe(loginRequestSchema))
    body: z.output<typeof loginRequestSchema>,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<SessionResponse> {
    const { sessionToken, session } = await this.auth.login(
      body,
      readSessionToken(request),
      requestIdOf(request),
    );
    response.appendHeader('Set-Cookie', sessionCookie(sessionToken));
    return this.auth.sessionResponse(session);
  }

  /** Ends the session on the server and deletes the cookie. Requires the CSRF token. */
  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard, SessionGuard, CsrfGuard)
  async logout(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    await this.auth.logout(requireSession(request), requestIdOf(request));
    response.appendHeader('Set-Cookie', clearedSessionCookie());
  }

  /** The signed-in user, the session's expiry and its CSRF token. */
  @Get('session')
  @SkipThrottle()
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard)
  session(@Req() request: ApiRequest): SessionResponse {
    return this.auth.sessionResponse(requireSession(request));
  }

  /** 202 whether or not the address has an account. */
  @Post('password-reset/request')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  requestPasswordReset(
    @Body(new ZodPipe(emailRequestSchema))
    body: z.output<typeof emailRequestSchema>,
    @Req() request: ApiRequest,
  ): typeof ACCEPTED {
    this.auth.requestPasswordReset(body.email, requestIdOf(request));
    return ACCEPTED;
  }

  /** Sets the new password and ends every session; the user then signs in again. */
  @Post('password-reset/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  async confirmPasswordReset(
    @Body(new ZodPipe(passwordResetConfirmRequestSchema))
    body: z.output<typeof passwordResetConfirmRequestSchema>,
    @Req() request: ApiRequest,
  ): Promise<{ status: 'password_reset' }> {
    await this.auth.confirmPasswordReset(
      body.token,
      body.newPassword,
      requestIdOf(request),
    );
    return { status: 'password_reset' };
  }
}
