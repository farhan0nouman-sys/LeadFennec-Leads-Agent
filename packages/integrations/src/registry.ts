import type { AppEnv } from '@lead-fennec-ai/shared';
import {
  APOLLO_ORGANIZATION_SEARCH_CAPABILITIES,
  ApolloOrganizationSearchProvider,
} from './apollo-organization-search.js';
import {
  ApolloContactEnrichmentProvider,
  ApolloPeopleSearchProvider,
} from './apollo-people.js';
import { FAKE_ORGANIZATION_SEARCH_CAPABILITIES } from './fake-organization-search.js';
import { createFakeProviders } from './fakes.js';
import type {
  ContactEnrichmentProvider,
  EmailVerificationProvider,
  OrganizationSearchProvider,
  PeopleSearchProvider,
  ProviderSet,
} from './providers.js';
import { FakeModelProvider } from './model/fake.js';
import {
  OpenAiResponsesProvider,
  type OpenAiReasoningEffort,
} from './model/openai.js';
import type { ModelPrices, ModelProvider } from './model/types.js';
import { FakeWebsiteFetcher } from './website/fake.js';
import { SafeWebsiteFetcher } from './website/fetcher.js';
import type { WebsiteFetcher } from './website/types.js';

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

/**
 * The people lookup and enrichment providers for this environment (task 08B, D-08B-05): the
 * deterministic fakes in development and test, whatever the configuration; Apollo in staging
 * and production, which needs APOLLO_API_KEY (unconfigured fails closed).
 */
export function createContactDataProviders(
  appEnv: AppEnv,
  config: OrganizationSearchConfig,
): {
  readonly peopleSearch: PeopleSearchProvider;
  readonly contactEnrichment: ContactEnrichmentProvider;
} {
  if (isLocal(appEnv)) {
    const fakes = createFakeProviders();
    return {
      peopleSearch: fakes.peopleSearch,
      contactEnrichment: fakes.contactEnrichment,
    };
  }
  if (config.apolloApiKey === undefined || config.apolloApiKey === '') {
    throw new LiveProvidersUnavailableError(
      'APOLLO_API_KEY is not set, so people lookup and enrichment have no provider.',
    );
  }
  const options = { apiKey: config.apolloApiKey };
  return {
    peopleSearch: new ApolloPeopleSearchProvider(options),
    contactEnrichment: new ApolloContactEnrichmentProvider(options),
  };
}

/**
 * The email verification provider (task 08B, D-08B-06): the fake in development and test. No
 * live verification service is chosen yet, so staging and production fail closed (O-35).
 */
export function createEmailVerificationProvider(
  appEnv: AppEnv,
): EmailVerificationProvider {
  if (isLocal(appEnv)) {
    return createFakeProviders().emailVerification;
  }
  throw new LiveProvidersUnavailableError(
    'No email verification service is selected, so addresses cannot be checked (docs/decisions.md O-35).',
  );
}

/** The access restrictions of website fetching, from the app's validated environment. */
export interface WebsiteFetchConfig {
  /** WEBSITE_FETCH_BLOCKED_HOSTS: never fetched, with their subdomains. */
  readonly blockedHosts?: readonly string[] | undefined;
  /** WEBSITE_FETCH_ALLOWED_HOSTS: when set, only these (and their subdomains) are fetched. */
  readonly allowedHosts?: readonly string[] | undefined;
}

/**
 * The website fetcher for this environment (task 09A, docs/decisions.md D-09A-07): the
 * synthetic fake in development and test (it never connects), the safe live fetcher in
 * staging and production. Both apply the same URL checks and access restrictions; an invalid
 * restriction throws here, before any fetch.
 */
export function createWebsiteFetcher(
  appEnv: AppEnv,
  config: WebsiteFetchConfig = {},
): WebsiteFetcher {
  const policy = {
    blockedHosts: [...(config.blockedHosts ?? [])],
    allowedHosts:
      config.allowedHosts === undefined || config.allowedHosts.length === 0
        ? null
        : [...config.allowedHosts],
  };
  if (isLocal(appEnv)) {
    // The real clock: stored pages and evidence show when they were read (task 09C). Unit
    // tests that need a fixed time build the fake themselves.
    return new FakeWebsiteFetcher({ policy, now: () => new Date() });
  }
  return new SafeWebsiteFetcher({ policy });
}

/** The model configuration, from the app's validated environment (task 09B). */
export interface ModelConfig {
  /** OPENAI_API_KEY. Ignored in development and test, which always use the fake. */
  readonly openAiApiKey?: string | undefined;
  /** OPENAI_MODEL. */
  readonly openAiModel?: string | undefined;
  /** OPENAI_REASONING_EFFORT. */
  readonly openAiReasoningEffort?: OpenAiReasoningEffort | undefined;
  /** OPENAI_INPUT_USD_PER_MTOK and OPENAI_OUTPUT_USD_PER_MTOK, both or neither. */
  readonly prices?: ModelPrices | null | undefined;
}

/**
 * The model provider for this environment (task 09B, docs/decisions.md D-09B-02): the fake in
 * development and test, whatever the configuration; OpenAI in staging and production, which
 * needs OPENAI_API_KEY and OPENAI_MODEL (unconfigured fails closed).
 */
export function createModelProvider(
  appEnv: AppEnv,
  config: ModelConfig,
): ModelProvider {
  if (isLocal(appEnv)) {
    return new FakeModelProvider();
  }
  if (
    config.openAiApiKey === undefined ||
    config.openAiApiKey === '' ||
    config.openAiModel === undefined ||
    config.openAiModel === ''
  ) {
    throw new LiveProvidersUnavailableError(
      'OPENAI_API_KEY and OPENAI_MODEL must both be set, so there is no model provider.',
    );
  }
  return new OpenAiResponsesProvider({
    apiKey: config.openAiApiKey,
    model: config.openAiModel,
    reasoningEffort: config.openAiReasoningEffort,
    prices: config.prices ?? null,
  });
}
