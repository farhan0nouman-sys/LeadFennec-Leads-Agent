import { EnvValidationError } from './env.js';
import { describeError } from './redact.js';

/**
 * Turns an error thrown during startup into a short, actionable message for known cases
 * (invalid environment, port in use). Returns undefined for anything else.
 */
export function describeStartupError(
  appName: string,
  error: unknown,
): string | undefined {
  if (error instanceof EnvValidationError) {
    return error.message;
  }
  if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'EADDRINUSE'
  ) {
    return `[${appName}] Port already in use: ${describeError(error)}. Stop the other process or change the port in .env.`;
  }
  return undefined;
}
