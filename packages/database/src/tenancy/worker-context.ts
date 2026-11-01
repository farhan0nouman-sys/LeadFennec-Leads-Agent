// Worker authorization context (task 04B, docs/decisions.md D-04B-05). A queue message carries
// only the id of a durable job_tasks row. The worker loads the row and takes the tenant from it,
// never from the message: a forged or replayed message can name a task, but not move it to
// another workspace, give it to a worker that does not handle its type, or run it twice.
import { z } from 'zod';
import type {
  JobTask,
  Prisma,
  PrismaClient,
} from '../generated/prisma/client.js';
import { systemScope, type ScopeOptions, type TenantScope } from './access.js';
import {
  ActorNotAllowedError,
  dottedKeySchema,
  systemActorNameSchema,
} from './actors.js';

/** The only thing a queue message may contain. Any other field (e.g. a tenant id) is refused. */
export const jobEnvelopeSchema = z
  .object({ v: z.literal(1), taskId: z.uuid() })
  .strict();

export type JobEnvelope = z.output<typeof jobEnvelopeSchema>;

export type JobRejection =
  /** Not a valid envelope (including one that names a tenant). */
  | 'malformed'
  /** No task with this id. */
  | 'unknown_task'
  /** The task's type is not one this worker handles. */
  | 'wrong_worker'
  /** The task's workspace is suspended or archived. */
  | 'workspace_inactive'
  /** Already running or finished, not due yet, or out of attempts: acknowledge and drop. */
  | 'not_claimable';

export class JobRejectedError extends Error {
  constructor(readonly reason: JobRejection) {
    super(`Job rejected: ${reason}`);
    this.name = 'JobRejectedError';
  }
}

export interface WorkerDefinition {
  /** Snake-case name; it is the system actor in audit records. */
  readonly name: string;
  /** Task types (dotted keys) this worker may run. */
  readonly taskTypes: readonly string[];
}

const workerSchema = z
  .object({
    name: systemActorNameSchema,
    taskTypes: z.array(dottedKeySchema).min(1),
  })
  .strict();

export function defineWorker(definition: WorkerDefinition): WorkerDefinition {
  const { name, taskTypes } = workerSchema.parse({
    name: definition.name,
    taskTypes: [...definition.taskTypes],
  });
  return Object.freeze({ name, taskTypes: Object.freeze([...taskTypes]) });
}

export interface WorkerContext {
  readonly worker: WorkerDefinition;
  /** Taken from the task row. */
  readonly tenantId: string;
  /** The claimed task (RUNNING). Its payload is validated by the worker's own schema. */
  readonly task: JobTask;
  /**
   * Tenant scope of the task's workspace, acting as the worker. Record ids from the payload are
   * looked up through it, so ids of another workspace are simply not found.
   */
  readonly scope: TenantScope;
  complete(): Promise<void>;
  /** Retries at `retryAt` while attempts remain; otherwise marks the task FAILED. */
  fail(input: { errorCode: string; retryAt?: Date }): Promise<void>;
}

const errorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/** Creates (or finds, by idempotency key) a task in the scope's workspace; returns its envelope. */
export async function enqueueJob(
  scope: TenantScope,
  input: {
    taskType: string;
    idempotencyKey: string;
    payload: Prisma.InputJsonObject;
    availableAt?: Date;
    maxAttempts?: number;
  },
): Promise<JobEnvelope> {
  if (scope.actor.kind === 'platform_admin') {
    throw new ActorNotAllowedError('jobs.enqueue');
  }
  const taskType = dottedKeySchema.parse(input.taskType);
  const idempotencyKey = z.string().min(1).max(200).parse(input.idempotencyKey);
  await scope.db.jobTask.createMany({
    data: [
      {
        tenantId: scope.tenantId,
        taskType,
        idempotencyKey,
        payload: input.payload,
        ...(input.availableAt === undefined
          ? {}
          : { availableAt: input.availableAt }),
        ...(input.maxAttempts === undefined
          ? {}
          : { maxAttempts: input.maxAttempts }),
      },
    ],
    skipDuplicates: true,
  });
  const task = await scope.db.jobTask.findUniqueOrThrow({
    where: {
      tenantId_taskType_idempotencyKey: {
        tenantId: scope.tenantId,
        taskType,
        idempotencyKey,
      },
    },
    select: { id: true },
  });
  return { v: 1, taskId: task.id };
}

/**
 * Authorizes and claims the task a queue message names, for `worker`. Throws JobRejectedError
 * when the message must not run; the caller logs the reason (never the message) and drops it.
 */
export async function claimJob(
  prisma: PrismaClient,
  worker: WorkerDefinition,
  message: unknown,
  options: ScopeOptions = {},
): Promise<WorkerContext> {
  const now = options.now ?? (() => new Date());
  const envelope = jobEnvelopeSchema.safeParse(message);
  if (!envelope.success) {
    throw new JobRejectedError('malformed');
  }
  const task = await prisma.jobTask.findUnique({
    where: { id: envelope.data.taskId },
  });
  if (task === null) {
    throw new JobRejectedError('unknown_task');
  }
  if (!worker.taskTypes.includes(task.taskType)) {
    throw new JobRejectedError('wrong_worker');
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: task.tenantId },
    select: { status: true },
  });
  if (tenant?.status !== 'ACTIVE') {
    throw new JobRejectedError('workspace_inactive');
  }
  const startedAt = now();
  if (
    task.status !== 'PENDING' ||
    task.availableAt > startedAt ||
    task.attemptCount >= task.maxAttempts
  ) {
    throw new JobRejectedError('not_claimable');
  }
  // Claim exactly the version that was read: a concurrent claim makes this update nothing.
  const [claimed] = await prisma.jobTask.updateManyAndReturn({
    where: {
      tenantId: task.tenantId,
      id: task.id,
      status: 'PENDING',
      attemptCount: task.attemptCount,
    },
    data: {
      status: 'RUNNING',
      attemptCount: task.attemptCount + 1,
      startedAt,
      finishedAt: null,
    },
  });
  if (claimed === undefined) {
    throw new JobRejectedError('not_claimable');
  }
  const tenantId = claimed.tenantId;
  const settle = async (data: Prisma.JobTaskUpdateManyMutationInput) => {
    await prisma.jobTask.updateMany({
      where: { tenantId, id: claimed.id, status: 'RUNNING' },
      data,
    });
  };
  return {
    worker,
    tenantId,
    task: claimed,
    scope: systemScope(prisma, { tenantId, name: worker.name }, options),
    complete: () => settle({ status: 'SUCCEEDED', finishedAt: now() }),
    fail: ({ errorCode, retryAt }) => {
      const code = errorCodeSchema.parse(errorCode);
      return retryAt !== undefined && claimed.attemptCount < claimed.maxAttempts
        ? settle({
            status: 'PENDING',
            availableAt: retryAt,
            lastErrorCode: code,
          })
        : settle({ status: 'FAILED', finishedAt: now(), lastErrorCode: code });
    },
  };
}
