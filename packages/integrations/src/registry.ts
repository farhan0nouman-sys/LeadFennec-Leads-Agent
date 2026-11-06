import type { AppEnv } from '@lead-fennec-ai/shared';
import {
  APOLLO_ORGANIZATION_SEARCH_CAPABILITIES,
  ApolloOrganizationSearchProvider,
} from './apollo-organization-search.js';
import { FAKE_ORGANIZATION_SEARCH_CAPABILITIES } from './fake-organization-search.js';
import { createFakeProviders } from './fakes.js';
import type { OrganizationSearchProvider, ProviderSet } from './providers.js';

export type ProviderMode = 'fake' | 'live';

export class LiveProvidersForbiddenError extends Error {
  override readonly name = 'LiveProvidersForbiddenError';
}

/** Live providers were requested, but no live adapter exists yet (staging, production). */
export class LiveProvidersUnavailableError extends Error {
  override readonly name = 'LiveProvidersUnavailableError';
}

const isLocal = (appEnv: AppEnv) =>
  appEnv === 'test' || appEnv === 'development';

/**
 * The only way to obtain providers. Tests and development can only ever get fakes: asking
 * for live providers there throws before any adapter is constructed.
 */
export function createProviders(
  appEnv: AppEnv,
  mode: ProviderMode,
): ProviderSet {
  if (mode === 'fake') {
    return createFakeProviders();
  }
  if (isLocal(appEnv)) {
    throw new LiveProvidersForbiddenError(
      `Live providers are disabled when APP_ENV=${appEnv}; use fake providers.`,
    );
  }
  throw new LiveProvidersUnavailableError(
    'No live provider adapters exist yet.',
  );
}

/** Credentials for organization search, from the app's validated environment. */
export interface OrganizationSearchConfig {
  /** APOLLO_API_KEY. Ignored in development and test, which always use the fake. */
  readonly apolloApiKey?: string | undefined;
}

/**
 * The organization search provider for this environment (task 07B, docs/decisions.md
 * D-07B-05): the deterministic fake in development and test, whatever the configuration;
 * Apollo in staging and production, which needs APOLLO_API_KEY.
 */
export function createOrganizationSearchProvider(
  appEnv: AppEnv,
  config: OrganizationSearchConfig,
): OrganizationSearchProvider {
  if (isLocal(appEnv)) {
    return createFakeProviders().organizationSearch;
  }
  if (config.apolloApiKey === undefined || config.apolloApiKey === '') {
    throw new LiveProvidersUnavailableError(
      'APOLLO_API_KEY is not set, so organization search has no provider.',
    );
  }
  return new ApolloOrganizationSearchProvider({
    apiKey: config.apolloApiKey,
  });
}

/**
 * Which provider searches in this environment and what it supports, without credentials:
 * enough to check and store a request (the API), not to search.
 */
export function organizationSearchDeclaration(appEnv: AppEnv) {
  return isLocal(appEnv)
    ? ({
        source: 'FAKE',
        capabilities: FAKE_ORGANIZATION_SEARCH_CAPABILITIES,
      } as const)
    : ({
        source: 'APOLLO',
        capabilities: APOLLO_ORGANIZATION_SEARCH_CAPABILITIES,
      } as const);
}
