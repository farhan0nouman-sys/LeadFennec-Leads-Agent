import type { ServerResponse } from 'node:http';
import type { ApiErrorResponse } from '@lead-fennec-ai/shared';
import {
  BadRequestException,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';

/**
 * App-wide: a request Nest rejects before any route runs (e.g. a body that is not valid
 * JSON) gets the contract's error envelope. Nest's default message would quote the parser
 * error, which can contain parts of the body (such as a password); this one never does.
 */
@Catch(BadRequestException)
export class RequestErrorFilter implements ExceptionFilter {
  catch(_exception: BadRequestException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const body: ApiErrorResponse = {
      error: {
        code: 'validation_failed',
        message:
          'The request is invalid. Send a JSON body that matches the API contract.',
      },
    };
    response.statusCode = 400;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(body));
  }
}
