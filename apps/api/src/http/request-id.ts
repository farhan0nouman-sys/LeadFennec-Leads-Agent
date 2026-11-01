// Request ids for audit records.
import type { IncomingMessage } from 'node:http';

/**
 * The request id pino-http assigned (X-Request-Id), for audit records, when it has the safe
 * shape resolveRequestId produces.
 */
export function requestIdOf(request: IncomingMessage): string | undefined {
  const id: unknown = request.id;
  return typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id)
    ? id
    : undefined;
}
