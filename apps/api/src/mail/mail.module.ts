import {
  createProviders,
  type TransactionalMailProvider,
} from '@lead-fennec-ai/integrations';
import { Global, Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../env.js';

/** Platform email to users (verification, password reset, security notices). */
export const TRANSACTIONAL_MAIL = Symbol('TRANSACTIONAL_MAIL');

@Global()
@Module({
  providers: [
    {
      provide: TRANSACTIONAL_MAIL,
      inject: [API_ENV],
      // Development and test always use the fake (it records, never sends). Staging and
      // production ask for the live adapter, which does not exist yet (O-19), so the API
      // refuses to start there rather than silently dropping account email.
      useFactory: (env: ApiEnv): TransactionalMailProvider =>
        createProviders(
          env.APP_ENV,
          env.APP_ENV === 'development' || env.APP_ENV === 'test'
            ? 'fake'
            : 'live',
        ).mail,
    },
  ],
  exports: [TRANSACTIONAL_MAIL],
})
export class MailModule {}
