// HTTP settings every API instance shares (main.ts and the test harness), so tests run the app
// as deployed (task 07C, docs/decisions.md D-07C-04).
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * JSON bodies up to 1 MB: a CSV import carries its file (at most 256 KB of text, which JSON
 * escaping can roughly double). Larger bodies are refused with 413 before any route runs.
 */
export const JSON_BODY_LIMIT = '1mb';

export function configureApp(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
}
