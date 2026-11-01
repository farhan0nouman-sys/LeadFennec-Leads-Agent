import type { AppEnv } from '@lead-fennec-ai/shared';
import { createFakeProviders } from './fakes.js';
import type { ProviderSet } from './providers.js';

export type ProviderMode = 'fake' | 'live';

export class LiveProvidersForbiddenError extends Error {
  override readonly name = 'LiveProvidersForbiddenError';
}

/** Live providers were requested, but no live adapter exists yet (staging, production). */
export class LiveProvidersUnavailableError extends Error {
  override readonly name = 'LiveProvidersUnavailableError';
}

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
  if (appEnv === 'test' || appEnv === 'development') {
    throw new LiveProvidersForbiddenError(
      `Live providers are disabled when APP_ENV=${appEnv}; use fake providers.`,
    );
  }
  throw new LiveProvidersUnavailableError(
    'No live provider adapters exist yet.',
  );
}
