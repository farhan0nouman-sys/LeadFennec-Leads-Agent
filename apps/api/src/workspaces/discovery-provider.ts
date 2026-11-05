// The organization search provider of lead discovery (task 07A, docs/decisions.md D-07A-04).
// Development and test always use the deterministic fake (synthetic companies, no network).
// Staging and production ask for the live adapter, which does not exist yet (task 07B), so the
// API refuses to start there rather than searching with a stand-in. Only tests override it.
import {
  createProviders,
  type OrganizationSearchProvider,
} from '@lead-fennec-ai/integrations';
import { API_ENV, type ApiEnv } from '../env.js';

export const ORGANIZATION_SEARCH = Symbol('ORGANIZATION_SEARCH');

export const organizationSearchProvider = {
  provide: ORGANIZATION_SEARCH,
  inject: [API_ENV],
  useFactory: (env: ApiEnv): OrganizationSearchProvider =>
    createProviders(
      env.APP_ENV,
      env.APP_ENV === 'development' || env.APP_ENV === 'test' ? 'fake' : 'live',
    ).organizationSearch,
};
