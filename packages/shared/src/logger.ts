import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  pino,
  type DestinationStream,
  type Logger,
  type LoggerOptions as PinoOptions,
} from 'pino';
import type { Options as HttpLoggerOptions } from 'pino-http';
import type { LogLevel } from './env.js';
import { redactSecrets } from './redact.js';

// Server-only entry point (@lead-fennec-ai/shared/logger): structured JSON logs.

/** Object paths whose values are replaced with "[REDACTED]" in every log line. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["proxy-authorization"]',
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  ...[
    'password',
    'newPassword',
    'passwordHash',
    'secret',
    'token',
    'csrfToken',
    'sessionToken',
    'accessToken',
    'refreshToken',
    'apiKey',
    'authorization',
    'DATABASE_URL',
    'REDIS_URL',
    'TEST_DATABASE_URL',
    'TEST_REDIS_URL',
    'APOLLO_API_KEY',
  ].flatMap((key) => [key, `*.${key}`]),
];

export interface CreateLoggerOptions {
  readonly app: string;
  readonly level: LogLevel;
  /** Defaults to stdout. Tests pass an in-memory stream. */
  readonly destination?: DestinationStream;
}

/**
 * JSON logger with two redaction layers:
 * 1. `redact` censors known secret fields (auth headers, cookies, password/token/key fields).
 * 2. `hooks.streamWrite` masks credentials embedded in URLs in the final JSON line, so it
 *    also covers messages, error messages/stacks and fields added by child loggers and
 *    third-party serializers (e.g. pino-http's own `err` serializer).
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const config: PinoOptions = {
    level: options.level,
    base: { app: options.app },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    hooks: { streamWrite: redactSecrets },
  };
  return options.destination === undefined
    ? pino(config)
    : pino(config, options.destination);
}

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Reuses a well-formed incoming request ID, otherwise generates one. Untrusted input. */
export function resolveRequestId(
  header: string | string[] | undefined,
): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate !== undefined && SAFE_REQUEST_ID.test(candidate)
    ? candidate
    : randomUUID();
}

/** pino-http options shared by every HTTP server: request IDs echoed in X-Request-Id. */
export function httpLoggerOptions(logger: Logger): HttpLoggerOptions {
  return {
    logger,
    genReqId(req: IncomingMessage, res: ServerResponse) {
      const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customLogLevel(_req, res, error) {
      if (error !== undefined || res.statusCode >= 500) {
        return 'error';
      }
      return res.statusCode >= 400 ? 'warn' : 'info';
    },
  };
}
