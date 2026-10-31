import { httpLoggerOptions } from '@lead-fennec-ai/shared/logger';
import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Logger } from 'pino';
import type { ApiEnv } from './env.js';
import { EnvModule } from './env.module.js';
import { HealthModule } from './health/health.module.js';

@Module({})
export class AppModule {
  /** Every request is logged as JSON with its request ID (X-Request-Id). */
  static forRoot(env: ApiEnv, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        LoggerModule.forRoot({ pinoHttp: httpLoggerOptions(logger) }),
        HealthModule,
      ],
    };
  }
}
