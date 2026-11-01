import { httpLoggerOptions } from '@lead-fennec-ai/shared/logger';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { Logger } from 'pino';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './database/database.module.js';
import type { ApiEnv } from './env.js';
import { EnvModule } from './env.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { RequestErrorFilter } from './request-error.filter.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Module({})
export class AppModule {
  /** Every request is logged as JSON with its request ID (X-Request-Id). */
  static forRoot(env: ApiEnv, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        LoggerModule.forRoot({ pinoHttp: httpLoggerOptions(logger) }),
        DatabaseModule,
        MailModule,
        HealthModule,
        AuthModule,
        WorkspacesModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: RequestErrorFilter }],
    };
  }
}
