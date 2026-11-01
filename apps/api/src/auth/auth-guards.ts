// Request guards for the auth routes (docs/decisions.md D-04A-05, D-04A-06).
import type { IncomingMessage } from 'node:http';
import { CSRF_HEADER_NAME } from '@lead-fennec-ai/shared';
import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../env.js';
import { constantTimeEqual, csrfTokenFor } from './auth-crypto.js';
import { ApiHttpException } from '../http/api-errors.js';
import { AuthService, type SessionContext } from './auth.service.js';
import { readSessionToken } from './session-cookie.js';

export interface ApiRequest extends IncomingMessage {
  /** Set by SessionGuard. */
  auth?: SessionContext;
}

/** The session SessionGuard attached; throws if the route forgot the guard. */
export function requireSession(request: ApiRequest): SessionContext {
  if (request.auth === undefined) {
    throw new Error('SessionGuard did not run for this route');
  }
  return request.auth;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Refuses state-changing requests that a browser sent from another site (CSRF, including
 * login CSRF): Fetch Metadata first, then the Origin header. Requests without either header
 * come from non-browser clients, which cannot carry a victim's cookies.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.allowedOrigin = env.WEB_APP_URL;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (SAFE_METHODS.has(request.method ?? 'GET')) {
      return true;
    }
    const site = header(request, 'sec-fetch-site');
    const origin = header(request, 'origin');
    const crossSite =
      (site !== undefined && site !== 'same-origin' && site !== 'none') ||
      (origin !== undefined && origin !== this.allowedOrigin);
    if (crossSite) {
      throw new ApiHttpException(
        403,
        'forbidden_origin',
        'This request must come from the Lead Fennec app.',
      );
    }
    return true;
  }
}

/** Requires a valid, unexpired session cookie; attaches it to the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    request.auth = await this.auth.authenticate(readSessionToken(request));
    return true;
  }
}

/**
 * Synchronizer-token check for authenticated mutations: the x-csrf-token header must equal
 * the session's CSRF token. Runs after SessionGuard.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (SAFE_METHODS.has(request.method ?? 'GET')) {
      return true;
    }
    const session = requireSession(request);
    const sent = header(request, CSRF_HEADER_NAME) ?? '';
    if (!constantTimeEqual(sent, csrfTokenFor(session.sessionToken))) {
      throw new ApiHttpException(
        403,
        'csrf_failed',
        'The request is missing a valid CSRF token.',
      );
    }
    return true;
  }
}
