import { infrastructureReadinessChecks } from '@lead-fennec-ai/database';
import { Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../env.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { READINESS_CHECKS } from './health.tokens.js';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: READINESS_CHECKS,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        infrastructureReadinessChecks({
          databaseUrl: env.DATABASE_URL,
          redisUrl: env.REDIS_URL,
        }),
    },
    HealthService,
  ],
})
export class HealthModule {}
