import { describeStartupError } from '@lead-fennec-ai/shared';
import { loadWebEnv } from './env';

/**
 * Validates the web server's environment. Next.js only logs errors thrown from the
 * instrumentation hook and keeps serving, so an invalid environment exits explicitly.
 */
export function validateEnvOrExit(): void {
  try {
    loadWebEnv(process.env);
  } catch (error) {
    const message = describeStartupError('web', error);
    if (message === undefined) {
      throw error;
    }
    console.error(message);
    process.exit(1);
  }
}
