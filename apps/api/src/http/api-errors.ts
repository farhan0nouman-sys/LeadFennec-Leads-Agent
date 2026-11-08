// The API's error envelope { error: { code, message, … } } (@lead-fennec-ai/shared
// contracts/workspaces.ts apiErrorResponseSchema), for every route.
import type { ServerResponse } from 'node:http';
import {
  ActorNotAllowedError,
  AlreadyMemberError,
  CampaignConfigurationError,
  CampaignNameTakenError,
  CampaignNotEditableError,
  CampaignNotReadyError,
  CampaignVersionConflictError,
  CsvImportError,
  DiscoveryRequestError,
  EnrichmentRequestError,
  ImportNotCancellableError,
  InvalidCursorError,
  InvitationError,
  LastAdminError,
  NoEmailAddressError,
  PermissionDeniedError,
  QualificationBlockedError,
  QualificationVersionConflictError,
  RecheckLimitError,
  RecordNotFoundError,
  ResearchCorrectionError,
  ResearchNotPossibleError,
  ResearchVersionConflictError,
  SendPolicyVersionConflictError,
  SlugTakenError,
  TenantAccessDeniedError,
  VerificationUnavailableError,
} from '@lead-fennec-ai/database';
import type { ApiErrorCode, ApiErrorResponse } from '@lead-fennec-ai/shared';
import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
  type PipeTransform,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ZodError, type z } from 'zod';
import { clearedSessionCookie } from '../auth/session-cookie.js';

interface ApiErrorExtras {
  readonly retryAfterSeconds?: number;
  readonly issues?: readonly { path: string; message: string }[];
  /** Also delete the session cookie (the session is unknown, ended or expired). */
  readonly clearSession?: boolean;
}

export class ApiHttpException extends HttpException {
  constructor(
    status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly extras: ApiErrorExtras = {},
  ) {
    super(message, status);
  }

  toBody(): ApiErrorResponse {
    const { retryAfterSeconds, issues } = this.extras;
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        ...(issues === undefined ? {} : { issues: [...issues] }),
      },
    };
  }
}

export const invalidCredentials = () =>
  new ApiHttpException(
    401,
    'invalid_credentials',
    'Email or password is incorrect.',
  );

export const tooManyRequests = (retryAfterSeconds: number) =>
  new ApiHttpException(
    429,
    'too_many_requests',
    'Too many attempts. Try again later.',
    {
      retryAfterSeconds,
    },
  );

export const notFound = () =>
  new ApiHttpException(404, 'not_found', 'Not found.');

export const forbidden = () =>
  new ApiHttpException(
    403,
    'forbidden',
    'You do not have permission to do this.',
  );

function validationFailed(error: ZodError): ApiHttpException {
  return new ApiHttpException(
    400,
    'validation_failed',
    'The request is invalid.',
    {
      issues: error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(body)',
        message: issue.message,
      })),
    },
  );
}

/**
 * Validates a body or query against a contract schema; issues never echo the input. The schema
 * is public so the API contract test can check it is the endpoint list's (task 05B).
 */
export class ZodPipe<TSchema extends z.ZodType> implements PipeTransform {
  constructor(readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw validationFailed(result.error);
    }
    return result.data;
  }
}

const INVITATION_ERRORS = {
  invalid: () =>
    new ApiHttpException(
      400,
      'invalid_or_expired_invitation',
      'This invitation is invalid or has expired. Ask for a new one.',
    ),
  identity_mismatch: () =>
    new ApiHttpException(
      403,
      'invitation_for_another_account',
      'This invitation was sent to another email address. Sign in with that address.',
    ),
  workspace_mismatch: () =>
    new ApiHttpException(
      400,
      'invitation_for_another_workspace',
      'This invitation is for another workspace.',
    ),
  already_member: () =>
    new ApiHttpException(
      409,
      'already_member',
      'You are already a member of this workspace.',
    ),
} as const;

/** Maps errors of the database layer to the envelope; null for anything else. */
export function toApiException(error: unknown): ApiHttpException | null {
  if (error instanceof ApiHttpException) {
    return error;
  }
  if (
    error instanceof PermissionDeniedError ||
    error instanceof ActorNotAllowedError
  ) {
    return forbidden();
  }
  if (
    error instanceof RecordNotFoundError ||
    error instanceof TenantAccessDeniedError
  ) {
    return notFound();
  }
  if (error instanceof LastAdminError) {
    return new ApiHttpException(
      409,
      'last_admin',
      'The workspace needs at least one active Client Admin.',
    );
  }
  if (error instanceof AlreadyMemberError) {
    return new ApiHttpException(
      409,
      'already_member',
      'This person is already a member of the workspace.',
    );
  }
  if (error instanceof SlugTakenError) {
    return new ApiHttpException(
      409,
      'slug_taken',
      'This workspace address is already taken.',
    );
  }
  if (error instanceof InvitationError) {
    return INVITATION_ERRORS[error.reason]();
  }
  if (error instanceof QualificationBlockedError) {
    // One issue per eligibility reason that blocks.
    return new ApiHttpException(
      409,
      'qualification_blocked',
      "This person may not be emailed, so they can't be qualified.",
      {
        issues: error.reasons.map((code) => ({
          path: 'eligibility',
          message: code,
        })),
      },
    );
  }
  if (error instanceof QualificationVersionConflictError) {
    return new ApiHttpException(
      409,
      'version_conflict',
      'This lead was decided on since you opened it. Reload it, then decide again.',
    );
  }
  if (error instanceof SendPolicyVersionConflictError) {
    return new ApiHttpException(
      409,
      'version_conflict',
      'The send policy was changed since you opened it. Reload it, then make your change again.',
    );
  }
  if (error instanceof CampaignVersionConflictError) {
    return new ApiHttpException(
      409,
      'version_conflict',
      'This campaign was changed since you opened it. Reload it, then make your change again.',
    );
  }
  if (error instanceof CampaignNotEditableError) {
    return new ApiHttpException(
      409,
      'campaign_not_editable',
      'Only draft campaigns can be changed.',
    );
  }
  if (error instanceof CampaignNameTakenError) {
    return new ApiHttpException(
      409,
      'campaign_name_taken',
      'Another campaign in this workspace has this name.',
    );
  }
  if (error instanceof CampaignNotReadyError) {
    // One issue per reason; the path is the check's key.
    return new ApiHttpException(
      409,
      'campaign_not_ready',
      "The campaign can't start yet. Every check must pass first.",
      {
        issues: error.report.checks.flatMap((check) =>
          check.reasons.map((reason) => ({ path: check.key, message: reason })),
        ),
      },
    );
  }
  if (error instanceof CampaignConfigurationError) {
    return new ApiHttpException(
      400,
      'validation_failed',
      'The request is invalid.',
      { issues: error.issues },
    );
  }
  if (error instanceof DiscoveryRequestError) {
    // One issue per reason: the ICP (icpId), the limit (maxResults) or its criteria (criteria.*).
    return new ApiHttpException(
      400,
      'validation_failed',
      "The search can't run as asked.",
      { issues: error.issues },
    );
  }
  if (error instanceof EnrichmentRequestError) {
    // One issue per reason: the run (importId), the campaign (campaignId) or its ICP (icpId).
    return new ApiHttpException(
      400,
      'validation_failed',
      "People can't be found for this run as asked.",
      { issues: error.issues },
    );
  }
  if (error instanceof NoEmailAddressError) {
    return new ApiHttpException(
      409,
      'no_email_address',
      'This contact has no email address to check.',
    );
  }
  if (error instanceof VerificationUnavailableError) {
    return new ApiHttpException(
      409,
      'verification_unavailable',
      "Email addresses can't be checked yet: no verification service is set up.",
    );
  }
  if (error instanceof RecheckLimitError) {
    return tooManyRequests(error.retryAfterSeconds);
  }
  if (error instanceof CsvImportError) {
    // The file (content) or the mapping (mapping.<field>): one issue per reason.
    return new ApiHttpException(
      400,
      'validation_failed',
      "The file can't be imported as it is.",
      { issues: error.issues },
    );
  }
  if (error instanceof ImportNotCancellableError) {
    return new ApiHttpException(
      409,
      'import_not_cancellable',
      'This import already finished, so it can no longer be cancelled.',
    );
  }
  if (error instanceof ResearchNotPossibleError) {
    return new ApiHttpException(
      409,
      'research_not_possible',
      'This company has no website or domain to research.',
    );
  }
  if (error instanceof ResearchVersionConflictError) {
    return new ApiHttpException(
      409,
      'version_conflict',
      'The research changed since you opened it. Reload it, then make your correction again.',
    );
  }
  if (error instanceof ResearchCorrectionError) {
    return new ApiHttpException(
      400,
      'validation_failed',
      'The correction is invalid.',
      {
        issues: [{ path: error.path, message: error.message }],
      },
    );
  }
  if (error instanceof InvalidCursorError) {
    return new ApiHttpException(
      400,
      'validation_failed',
      'The request is invalid.',
      {
        issues: [
          { path: 'cursor', message: 'Start again from the first page.' },
        ],
      },
    );
  }
  if (error instanceof ZodError) {
    return validationFailed(error);
  }
  return null;
}

function send(
  response: ServerResponse,
  status: number,
  body: ApiErrorResponse,
): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

/**
 * Writes API errors, rate-limit refusals and database-layer refusals in the envelope. Other
 * errors are not caught here: Nest answers them with a generic 500 without details. Bodies
 * that are not JSON are handled app-wide (RequestErrorFilter).
 */
@Catch(
  ApiHttpException,
  ThrottlerException,
  PermissionDeniedError,
  ActorNotAllowedError,
  RecordNotFoundError,
  TenantAccessDeniedError,
  LastAdminError,
  AlreadyMemberError,
  SlugTakenError,
  InvitationError,
  CampaignVersionConflictError,
  CampaignNotEditableError,
  CampaignNameTakenError,
  CampaignNotReadyError,
  CampaignConfigurationError,
  DiscoveryRequestError,
  EnrichmentRequestError,
  NoEmailAddressError,
  VerificationUnavailableError,
  RecheckLimitError,
  CsvImportError,
  ImportNotCancellableError,
  ResearchNotPossibleError,
  ResearchVersionConflictError,
  ResearchCorrectionError,
  SendPolicyVersionConflictError,
  QualificationBlockedError,
  QualificationVersionConflictError,
  InvalidCursorError,
  ZodError,
)
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    if (exception instanceof ThrottlerException) {
      // The throttler guard has already set Retry-After (seconds).
      const retryAfter = Number(response.getHeader('Retry-After'));
      send(
        response,
        429,
        tooManyRequests(
          Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter : 60,
        ).toBody(),
      );
      return;
    }
    const mapped = toApiException(exception) ?? notFound();
    if (mapped.extras.clearSession === true) {
      response.appendHeader('Set-Cookie', clearedSessionCookie());
    }
    if (mapped.extras.retryAfterSeconds !== undefined) {
      response.setHeader(
        'Retry-After',
        String(mapped.extras.retryAfterSeconds),
      );
    }
    send(response, mapped.getStatus(), mapped.toBody());
  }
}
