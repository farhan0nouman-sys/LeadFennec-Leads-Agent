// Work that runs after the response (docs/decisions.md D-04A-07): account-dependent steps of
// register, resend-verification and password-reset requests, so the response cannot reveal
// whether an account exists, through its content or its timing.
import { describeError } from '@lead-fennec-ai/shared';
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';

@Injectable()
export class AuthTasks implements OnApplicationShutdown {
  private readonly logger = new Logger(AuthTasks.name);
  private readonly pending = new Set<Promise<void>>();

  /** Starts `task` without waiting for it. Failures are logged by name, never their inputs. */
  run(name: string, task: () => Promise<void>): void {
    const running: Promise<void> = task()
      .catch((error: unknown) => {
        this.logger.error(
          `Auth task "${name}" failed: ${describeError(error)}`,
        );
      })
      .finally(() => {
        this.pending.delete(running);
      });
    this.pending.add(running);
  }

  /** Resolves once every started task has finished (tests and shutdown). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }
}
