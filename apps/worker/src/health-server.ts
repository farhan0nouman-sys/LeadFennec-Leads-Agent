import { createServer, type Server, type ServerResponse } from 'node:http';
import {
  LIVENESS_OK,
  runReadinessChecks,
  type ReadinessCheck,
} from '@lead-fennec-ai/shared';
import { httpLoggerOptions } from '@lead-fennec-ai/shared/logger';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

/**
 * Health endpoints for the worker process:
 * GET /health/live  → 200 while the process runs.
 * GET /health/ready → 200 when every dependency check passes, 503 otherwise.
 * Every request is logged as JSON with its request ID (X-Request-Id).
 */
export function createHealthServer(
  checks: readonly ReadinessCheck[],
  timeoutMs: number,
  logger: Logger,
): Server {
  const httpLogger = pinoHttp(httpLoggerOptions(logger));
  return createServer((req, res) => {
    httpLogger(req, res);
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(res, 405, { statusCode: 405, message: 'Method Not Allowed' });
      return;
    }
    if (path === '/health/live') {
      sendJson(res, 200, LIVENESS_OK);
      return;
    }
    if (path === '/health/ready') {
      void runReadinessChecks(checks, timeoutMs, (name, error) => {
        req.log.warn({ check: name, err: error }, 'readiness check failed');
      }).then((report) => {
        sendJson(res, report.status === 'ready' ? 200 : 503, report);
      });
      return;
    }
    sendJson(res, 404, { statusCode: 404, message: 'Not Found' });
  });
}
