import { describe, expect, it } from 'vitest';
import { FakeMailboxProvider } from './fakes.js';
import {
  contactDataDeclaration,
  createProviders,
  emailVerificationAvailable,
  LiveProvidersForbiddenError,
  LiveProvidersUnavailableError,
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

describe('contact enrichment declarations (task 08C)', () => {
  it('name the people provider without credentials, and fail verification closed when live', () => {
    for (const env of ['development', 'test'] as const) {
      expect(contactDataDeclaration(env)).toMatchObject({ source: 'FAKE' });
      expect(emailVerificationAvailable(env)).toBe(true);
    }
    for (const env of ['staging', 'production'] as const) {
      expect(contactDataDeclaration(env)).toEqual({
        source: 'APOLLO',
        attribution: 'People data from Apollo.io.',
      });
      expect(emailVerificationAvailable(env)).toBe(false);
    }
  });
});
