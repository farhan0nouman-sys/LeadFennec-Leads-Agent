// The people import job (task 11C, docs/decisions.md D-11C-01). A queue message names a job task;
// claimJob loads it and gives a scope of the task's own workspace. The import's waiting rows are
// saved one batch per transaction (scope.contactImports.saveBatch), so the run's progress moves
// with every batch and a run that stopped resumes at its next waiting row. A cancelled import
// stops before its next batch. Nothing here calls a provider: no paid work, nothing is sent.
import {
  claimJob,
  CONTACT_IMPORT_TASK_TYPE,
  defineWorker,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import { z } from 'zod';

export const CONTACT_IMPORT_WORKER = defineWorker({
  name: 'contact_import',
  taskTypes: [CONTACT_IMPORT_TASK_TYPE],
});

export interface ContactImportTaskDeps {
  readonly now?: () => Date;
}

export type ContactImportTaskOutcome =
  'completed' | 'cancelled' | 'skipped' | 'failed';

const payloadSchema = z.object({ importId: z.uuid() }).strict();

/** Most batches one task saves: a file of 1,000 rows has 10. */
const MAX_BATCHES = 20;

/**
 * Runs one people import to the end or to a failure. Throws JobRejectedError for a message that
 * must be dropped (the caller logs the reason, never the message).
 */
export async function runContactImportTask(
  prisma: PrismaClient,
  message: unknown,
  deps: ContactImportTaskDeps = {},
): Promise<ContactImportTaskOutcome> {
  const now = deps.now ?? (() => new Date());
  const ctx = await claimJob(prisma, CONTACT_IMPORT_WORKER, message, { now });
  const parsed = payloadSchema.safeParse(ctx.task.payload);
  if (!parsed.success) {
    await ctx.fail({ errorCode: 'invalid_payload' });
    return 'failed';
  }
  const { importId } = parsed.data;
  const imports = ctx.scope.contactImports;
  try {
    const start = await imports.begin(importId);
    if (start.state === 'stopped') {
      await ctx.complete();
      return start.status === 'CANCELLED' ? 'cancelled' : 'skipped';
    }
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const saved = await imports.saveBatch(importId);
      if (saved.state === 'stopped') {
        await ctx.complete();
        return 'cancelled';
      }
      if (saved.state === 'done') {
        break;
      }
    }
    const finished = await imports.finish(importId);
    await ctx.complete();
    return finished.status === 'COMPLETED' ? 'completed' : 'cancelled';
  } catch (error) {
    await imports
      .fail(importId, 'internal_error', true)
      .then(() => ctx.fail({ errorCode: 'internal_error' }))
      .catch(() => undefined);
    throw error;
  }
}
