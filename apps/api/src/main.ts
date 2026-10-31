import { describeStartupError } from '@lead-fennec-ai/shared';
import { createLogger } from '@lead-fennec-ai/shared/logger';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadApiEnv } from './env.js';

async function bootstrap(): Promise<void> {
  const env = loadApiEnv(process.env);
  const logger = createLogger({ app: 'api', level: env.LOG_LEVEL });
  const app = await NestFactory.create(AppModule.forRoot(env, logger), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(env.API_PORT);
}

try {
  await bootstrap();
} catch (error) {
  const message = describeStartupError('api', error);
  if (message === undefined) {
    throw error;
  }
  console.error(message);
  process.exitCode = 1;
}
