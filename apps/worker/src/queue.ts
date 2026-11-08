// The job queue (task 07C, docs/decisions.md D-07C-01): BullMQ on Redis, as the stack says.
// The database is the source of truth: a request writes a job_tasks row in its transaction,
// and the relay here publishes due PENDING tasks as { v: 1, taskId } with the task id as the
// BullMQ job id, so a task is queued once however often the relay runs. Retries are task rows
// becoming due again, not BullMQ retries. Jobs are removed when done, so a task that becomes
// due again can be queued again.
import {
  dueJobTasks,
  type JobEnvelope,
  type PrismaClient,
  type WorkerDefinition,
} from '@lead-fennec-ai/database';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

export const JOB_QUEUE_NAME = 'lead-fennec-jobs';
/** Website research (task 09C): its own queue, so each worker only receives its own tasks. */
export const RESEARCH_QUEUE_NAME = 'lead-fennec-research';
/** Lead qualification (task 10C): its own queue too. */
export const QUALIFICATION_QUEUE_NAME = 'lead-fennec-qualification';
/** Contact enrichment and address rechecks (task 08C). */
export const ENRICHMENT_QUEUE_NAME = 'lead-fennec-enrichment';

export type PublishJob = (envelope: JobEnvelope) => Promise<void>;

/** Publishes the due tasks of `worker`'s types; returns how many. */
export async function relayDueTasks(
  prisma: PrismaClient,
  publish: PublishJob,
  input: {
    readonly worker: WorkerDefinition;
    readonly now: Date;
    readonly limit?: number;
  },
): Promise<number> {
  const due = await dueJobTasks(prisma, {
    worker: input.worker,
    now: input.now,
    limit: input.limit ?? 100,
  });
  for (const envelope of due) {
    await publish(envelope);
  }
  return due.length;
}

export interface JobQueue {
  readonly publish: PublishJob;
  close(): Promise<void>;
}

/** The producer side. `redisUrl` comes from the validated environment. */
export function createJobQueue(
  redisUrl: string,
  queueName: string = JOB_QUEUE_NAME,
): JobQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const queue = new Queue<JobEnvelope>(queueName, { connection });
  return {
    publish: async (envelope) => {
      await queue.add('task', envelope, {
        jobId: envelope.taskId,
        removeOnComplete: true,
        removeOnFail: true,
      });
    },
    close: async () => {
      await queue.close();
      connection.disconnect();
    },
  };
}

/** The consumer side: one job at a time, each handed to `handle` as an untrusted message. */
export function createJobWorker(
  redisUrl: string,
  handle: (message: unknown) => Promise<void>,
  queueName: string = JOB_QUEUE_NAME,
): Worker<JobEnvelope> {
  // BullMQ requires maxRetriesPerRequest: null on a worker's connection.
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  return new Worker<JobEnvelope>(
    queueName,
    async (job) => {
      await handle(job.data);
    },
    { connection, concurrency: 1 },
  );
}
