import {
  describeError,
  runReadinessChecks,
  type ReadinessCheck,
  type ReadinessReport,
} from '@lead-fennec-ai/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { API_ENV } from '../env.js';
import type { ApiEnv } from '../env.js';
import { READINESS_CHECKS } from './health.tokens.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly timeoutMs: number;

  constructor(
    @Inject(READINESS_CHECKS)
    private readonly checks: readonly ReadinessCheck[],
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.timeoutMs = env.HEALTH_CHECK_TIMEOUT_MS;
  }

  readiness(): Promise<ReadinessReport> {
    return runReadinessChecks(this.checks, this.timeoutMs, (name, error) => {
      this.logger.warn(
        `Readiness check "${name}" failed: ${describeError(error)}`,
      );
    });
  }
}
