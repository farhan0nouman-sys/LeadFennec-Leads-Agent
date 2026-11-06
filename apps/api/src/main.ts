import { LiveProvidersUnavailableError } from '@lead-fennec-ai/integrations';
import { describeStartupError } from '@lead-fennec-ai/shared';
import { createLogger } from '@lead-fennec-ai/shared/logger';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadApiEnv } from './env.js';
import { configureApp } from './http/configure-app.js';

async function bootstrap(): Promise<void> {
  const env = loadApiEnv(process.env);
  const logger = createLogger({ app: 'api', level: env.LOG_LEVEL });
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(env, logger),
    {
      bufferLogs: true,
      // Startup errors reach the catch below instead of exiting inside Nest.
      abortOnError: false,
    },
  );
  // Rate limits key on req.ip: count only the proxies this deployment runs.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  configureApp(app);
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
}

try {
  await bootstrap();
} catch (error) {
  const message =
    error instanceof LiveProvidersUnavailableError
      ? `[api] ${error.message} Account email needs a live mail provider outside development and test (docs/decisions.md O-19).`
      : describeStartupError('api', error);
  if (message === undefined) {
    throw error;
  }
  console.error(message);
  process.exitCode = 1;
}
