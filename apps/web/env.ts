import { appEnvSchema, httpUrlSchema, parseEnv } from '@lead-fennec-ai/shared';
import { z } from 'zod';

// Server-only variables. Nothing here is NEXT_PUBLIC_, so none of it reaches the browser.
export const webEnvSchema = z.object({
  APP_ENV: appEnvSchema,
  /** Origin of the Lead Fennec API, used by server-side code to call it. */
  API_BASE_URL: httpUrlSchema,
});

export type WebEnv = z.output<typeof webEnvSchema>;

export function loadWebEnv(
  source: Readonly<Record<string, string | undefined>>,
): WebEnv {
  return parseEnv('web', webEnvSchema, source);
}
