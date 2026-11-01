import { describe, expect, it } from 'vitest';
import { FakeMailboxProvider } from './fakes.js';
import {
  LiveProvidersForbiddenError,
  LiveProvidersUnavailableError,
  createProviders,
} from './registry.js';

describe('createProviders', () => {
  it('returns fakes in fake mode', () => {
    expect(createProviders('test', 'fake').gmail).toBeInstanceOf(
      FakeMailboxProvider,
    );
  });

  it.each(['test', 'development'] as const)(
    'refuses live providers when APP_ENV=%s',
    (appEnv) => {
      expect(() => createProviders(appEnv, 'live')).toThrow(
        LiveProvidersForbiddenError,
      );
    },
  );

  it('has no live adapters yet for staging or production', () => {
    expect(() => createProviders('staging', 'live')).toThrow(
      /No live provider adapters/,
    );
    expect(() => createProviders('production', 'live')).toThrow(
      LiveProvidersUnavailableError,
    );
  });
});
