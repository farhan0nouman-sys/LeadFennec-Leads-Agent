// Runs a queued search with the real worker code against the scenarios' database (task 07C):
// apps/worker/dist/run-task.js, which works in development and test only. The test machines
// have no Redis, so the queue is skipped, not the job.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { e2eDatabaseUrl } from './env';

const execute = promisify(execFile);
// Playwright runs from apps/web, like the API server command in playwright.config.ts.
const RUN_TASK = resolve('../worker/dist/run-task.js');

/** The job's outcome: completed, cancelled, skipped, retrying or failed. */
export async function runSearchTask(taskId: string): Promise<string> {
  const { stdout } = await execute(process.execPath, [RUN_TASK, taskId], {
    env: {
      ...process.env,
      APP_ENV: 'test',
      LOG_LEVEL: 'warn',
      DATABASE_URL: e2eDatabaseUrl ?? '',
      // Never dialled by run-task.
      REDIS_URL: 'redis://127.0.0.1:1/15',
    },
    timeout: 60_000,
  });
  return stdout.trim();
}
