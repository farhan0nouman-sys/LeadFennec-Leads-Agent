// Which people provider an enrichment request is recorded with, and whether addresses can be
// checked here (task 08C, docs/decisions.md D-08C-01): the fakes in development and test, Apollo
// in staging and production, and no verification service there yet (O-35). The API gets
// declarations only, never credentials: APOLLO_API_KEY belongs to the worker that calls the
// provider. Only tests override these tokens.
import type { ContactProviderInfo } from '@lead-fennec-ai/database';
import {
  contactDataDeclaration,
  emailVerificationAvailable,
} from '@lead-fennec-ai/integrations';
import { API_ENV, type ApiEnv } from '../env.js';

export const CONTACT_PROVIDER = Symbol('CONTACT_PROVIDER');
export const EMAIL_VERIFICATION = Symbol('EMAIL_VERIFICATION');

/** Whether this environment can check addresses. */
export interface EmailVerificationInfo {
  readonly available: boolean;
}

export const contactProvider = {
  provide: CONTACT_PROVIDER,
  inject: [API_ENV],
  useFactory: (env: ApiEnv): ContactProviderInfo =>
    contactDataDeclaration(env.APP_ENV),
};

export const emailVerificationProvider = {
  provide: EMAIL_VERIFICATION,
  inject: [API_ENV],
  useFactory: (env: ApiEnv): EmailVerificationInfo => ({
    available: emailVerificationAvailable(env.APP_ENV),
  }),
};
