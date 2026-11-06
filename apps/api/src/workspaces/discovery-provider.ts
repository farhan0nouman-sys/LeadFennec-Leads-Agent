// Which organization search provider a discovery request is checked against (tasks 07A and
// 07B, docs/decisions.md D-07B-05): the fake in development and test, Apollo in staging and
// production. The API only checks and stores requests, so it gets the provider's declaration
// (source and capabilities) and never its credentials: APOLLO_API_KEY belongs to the worker
// that runs searches. Only tests override this token.
import type { DiscoveryProviderInfo } from '@lead-fennec-ai/database';
import { organizationSearchDeclaration } from '@lead-fennec-ai/integrations';
import { API_ENV, type ApiEnv } from '../env.js';

export const ORGANIZATION_SEARCH = Symbol('ORGANIZATION_SEARCH');

export const organizationSearchProvider = {
  provide: ORGANIZATION_SEARCH,
  inject: [API_ENV],
  useFactory: (env: ApiEnv): DiscoveryProviderInfo =>
    organizationSearchDeclaration(env.APP_ENV),
};
